# Knowledge Hub Backend 版本演进与改造全流程实战指南

本文档系统性汇总从 **v1 到 v8** 每个版本的**业务定位、架构图解、完整改造流程、核心代码实现步骤与联调测试方法**，作为各阶段版本迭代升级的实战手册。

---

## 目录
- [整体版本演进路线图](#整体版本演进路线图)
- [v1 分支：文档基础 CRUD 与双库分层架构](#v1-分支文档基础-crud-与双库分层架构)
- [v2 分支：多格式统一解析与对象存储引擎](#v2-分支多格式统一解析与对象存储引擎)
- [v3 分支：RabbitMQ 异步解耦与 RAG 向量切片管线](#v3-分支rabbitmq-异步解耦与-rag-向量切片管线)
- [v4 分支：双管线架构——全文检索 (Search) 与索引双向清理](#v4-分支双管线架构全文检索-search-与索引双向清理)
- [v5 分支：三管线架构——LLM 实体关系抽取与 Neo4j 知识图谱 (KG)](#v5-分支三管线架构llm-实体关系抽取与-neo4j-知识图谱-kg)
- [v6 分支：企业级文档状态机与多级审批流 (Review & Status Machine)](#v6-分支企业级文档状态机与多级审批流-review--status-machine)
- [v7 分支：JWT 用户认证与基于角色的权限控制 (RBAC)](#v7-分支jwt-用户认证与基于角色的权限控制-rbac)
- [v8 分支：用户与角色全生命周期管理、Redis 缓存与邮件安全服务](#v8-分支用户与角色全生命周期管理redis-缓存与邮件安全服务)
- [快速联调与测试命令对照表](#快速联调与测试命令对照表)

---

## 整体版本演进路线图

```text
v1: 基础 CRUD (Postgres 元数据 + Mongo 正文 + 雪花 ID)
 └─► v2: 统一文件解析引擎 (PDF/Word/Excel/PPT -> Markdown + RustFS 对象存储)
      └─► v3: 单管线 RAG (RabbitMQ 异步解耦 -> 切片 -> Embedding -> ES kh_chunk)
           └─► v4: 双管线 Search (新增 ES kh_document 全文索引 + 下架/删除双向清理)
                └─► v5: 三管线 KG (接入 Neo4j 图数据库 + LLM 抽取实体关系)
                     └─► v6: 企业级状态机 (Draft -> PendingReview -> Published -> Archived 审批流)
                          └─► v7: 用户认证与 RBAC 鉴权 (JWT 守卫 + 角色隔离 + 身份自动注入)
                               └─► v8: 用户/角色全生命周期管理 + Redis 缓存 + 邮件安全 (User/Role CRUD + 邮箱激活/重置密码)
```

---

## v1 分支：文档基础 CRUD 与双库分层架构

### 1. 核心定位与业务场景
构建 NestJS 后端底座，解决“长文本大字段导致关系型数据库性能下降”的问题，确立 PostgreSQL + MongoDB 的混合分层架构。

### 2. 存储设计
- **PostgreSQL (`kh_document`)**：记录结构化元数据（`id`, `title`, `summary`, `status`, `category_id`, `tags`, `author_id`, `created_at` 等）。
- **MongoDB (`document_contents`)**：独立集合存储非结构化大字段长文本正文（`content`），两者通过雪花 ID/ObjectID 关联。

### 3. 改造流程与开发步骤
1. **安装基础依赖**：
   ```bash
   pnpm add @nestjs/typeorm typeorm pg @nestjs/mongoose mongoose snowflake-id class-validator class-transformer
   ```
2. **定义实体与 Schema**：
   - 创建 `DocumentEntity` (TypeORM Postgres)。
   - 创建 `DocumentContent` (Mongoose Schema)。
3. **实现业务服务 `DocumentService`**：
   - **创建文档**：先写入 MongoDB 获得正文 ID，再写入 PostgreSQL 存储元数据。
   - **查询详情**：并行查 Postgres 元数据与 Mongo 正文，组装后返回。
   - **软删除**：Postgres 与 Mongo 两侧协同置 `deleted = true`。

---

## v2 分支：多格式统一解析与对象存储引擎

### 1. 核心定位与业务场景
用户直接上传办公文档（PDF、Word、Excel、PPT），系统自动提取内容、提取内嵌图片并标准化转换为结构化 Markdown。

### 2. 改造流程与开发步骤
1. **安装解析库与 S3 客户端**：
   ```bash
   pnpm add @aws-sdk/client-s3 pdf-parse mammoth exceljs officeparser turndown turndown-plugin-gfm multer
   pnpm add -D @types/multer @types/turndown
   ```
2. **配置对象存储服务 (RustFS/MinIO)**：
   - 在 `docker-compose.yml` 启动兼容 S3 协议的 RustFS 服务。
   - 编写 `RustfsService`：负责原文件归档、图片提取上传并生成公网访问 URL。
3. **构建统一解析调度服务 `FileParserService`**：
   - `pdf-parse`：提取文本；使用正则定位图片流并上传 RustFS，正文中替换为 `![](image_url)`。
   - `mammoth` + `turndown`：Word 文档转 HTML 再转 Markdown。
   - `exceljs`：读取 Sheet 单元格，拼接为 Markdown 表格语法。
   - `officeparser`：解析 PPT 幻灯片文本与演讲者备注。
4. **新增 API 端点**：
   - `POST /documents/upload/parse`：上传文件直接解析并落库为草稿。

---

## v3 分支：RabbitMQ 异步解耦与 RAG 向量切片管线

### 1. 核心定位与架构流转
将高耗时的 AI 切片、向量计算（Embedding）与 ES 写入通过消息队列解耦，保证发布接口毫秒级返回。

```text
[用户发起 PUT /publish]
        │
        ▼
1. DocumentController  ──> 接收发布请求
        │
        ▼
2. DocumentService     ──> 更新 DB 为 Published(1)，毫秒级返回前端
        │
        ▼ (投递消息)
3. DocumentPipelinePublisher ──> 向 RabbitMQ Exchange 投递 RAG_REINDEX 消息
        │
        ▼ (后台异步消费)
4. DocumentPipelineConsumer  ──> 接收到消息
        │
        ▼
5. PipelineOrchestrator      ──> 执行 RAG 处理流水线：
                                 ① deleteByDocId: 清空旧切片（幂等）
                                 ② ChunkingService: Markdown 层级切片
                                 ③ EmbeddingService: 调用百炼 text-embedding-v3
                                 ④ VectorIndexService: 写入 ES [kh_chunk]
```

### 2. 改造流程与开发步骤
1. **安装依赖**（注意：ES 客户端需锁定 8.x 版本）：
   ```bash
   pnpm add @elastic/elasticsearch@^8.17.0 amqp-connection-manager amqplib @langchain/core @langchain/openai @langchain/textsplitters
   pnpm add -D @types/amqplib
   ```
2. **环境配置**：
   - `docker-compose.yml` 启动 RabbitMQ (5672/15672) 与 Elasticsearch 8.17.0 (9200)。
   - `.env` 配置 `EMBEDDING_API_KEY`（阿里云百炼新控制台）。
3. **创建 MQ 模块 (`src/mq/`)**：
   - `mq.constants.ts`：定义 `RAG_REINDEX_EXCHANGE = 'rag.reindex.exchange'`，队列 `kh.rag.reindex.queue`。
   - `rabbitmq.service.ts`：连接 AMQP 并初始化 Exchange/Queue 拓扑声明。
   - `document-pipeline.publisher.ts`：封装 `afterPublish` 发送逻辑。
   - `document-pipeline.consumer.ts`：注册队列消费者。
4. **创建 Pipeline 模块 (`src/pipeline/`)**：
   - `chunking.service.ts`：Markdown 分块。
   - `embedding.service.ts`：对接 Embedding API。
   - `vector-index.service.ts`：初始化 `kh_chunk` 索引（`dense_vector` 映射），实现 `deleteByDocId` 与 `indexChunks`。
   - `pipeline.orchestrator.ts`：总控调度。
5. **改造发布入口**：
   - `DocumentService.publish(id)` 接入 `pipelinePublisher.afterPublish(doc)`。

---

## v4 分支：双管线架构——全文检索 (Search) 与索引双向清理

### 1. 核心定位与架构流转
在 RAG 语义检索的基础上增加关键词全文搜索能力，发布时双管线并行广播，下架/删除时双向同步清理。

```text
[文档发布 / 下架 / 删除]
        │
        ├───> 1. RAG 向量管道 (rag.reindex.exchange) ───> ES [kh_chunk] (语义向量)
        │
        └───> 2. Search 全文管道 (search.index.exchange) ───> ES [kh_document] (关键词全文)
```

### 2. 改造流程与开发步骤
1. **扩展 MQ 常量与消息体**：
   - `mq.constants.ts`：新增 `SEARCH_INDEX_EXCHANGE`、`SEARCH_INDEX_QUEUE` 及 `SEARCH_RK_INDEX`、`SEARCH_RK_DELETE`、`RAG_RK_DELETE`。
   - `pipeline.messages.ts`：新增 `SearchIndexMessage` 及 `DELETE_BY_DOC_IDS` 类型。
2. **实现全文检索服务 (`SearchIndexService`)**：
   - 管理 ES 中的 `kh_document` 索引（mapping 包含 `title`, `summary`, `content`, `tags`, `publishTime` 等）。
   - 实现 `indexDocument(doc)`（带时间戳 upsert）与 `deleteDocument(id)`。
3. **改造 MQ 生产者与消费者**：
   - `DocumentPipelinePublisher`：
     - `afterPublish`：`Promise.all` 并行投递 RAG 重排与 Search 索引（消息内截取正文前 1000 字作为快照）。
     - `afterUnpublish`：并行投递 RAG 删除与 Search 删除。
   - `DocumentPipelineConsumer`：增加 `SEARCH_INDEX_QUEUE` 监听器，调用 `orchestrator.handleSearchIndex`。
4. **业务层下架与删除接入**：
   - 在 `DocumentService.remove` 软删除时，调用 `pipelinePublisher.afterUnpublish(id)` 触发索引清理。

---

## v5 分支：三管线架构——LLM 实体关系抽取与 Neo4j 知识图谱 (KG)

### 1. 核心定位与三管道拓扑
接入图数据库，从非结构化文本中利用 LLM 自动抽离出网状知识实体与逻辑关联。

```text
[文档发布 / 下架 / 删除]
        │
        ├───> 1. RAG 向量管道 ────► ES [kh_chunk] (语义检索)
        │
        ├───> 2. Search 全文管道 ──► ES [kh_document] (关键词搜索)
        │
        └───> 3. KG 知识图谱管道 ──► LLM 实体关系抽取 ──► Neo4j 图数据库
```

### 2. 改造流程与开发步骤
1. **安装依赖与启动 Neo4j**：
   ```bash
   pnpm add neo4j-driver zod
   ```
   - 在 `docker-compose.yml` 中启动 Neo4j 5.x 容器（开放 7474 Web 界面与 7687 Bolt 协议，加载 APOC 插件）。
2. **图谱 Schema 与抽取服务**：
   - `kg-extraction.schema.ts`：使用 `zod` 定义结构化输出 Schema，定义实体类型（`ORGANIZATION`, `CONCEPT`, `PROCESS` 等）与关系类型（`REQUIRES`, `RESPONSIBLE_FOR`, `BELONGS_TO` 等）。
   - `extraction.service.ts`：调用大模型 structured output 解析 Chunk 文本。
3. **图谱构建与孤儿实体清理 (`GraphBuildService`)**：
   - 编写 Cypher 语句构建图谱网络：
     - `(KnowledgeDocument)`：文档节点
     - `(DocumentChunk)`：文本块节点
     - `(KnowledgeEntity)`：实体节点
     - 边关系：`(Document)-[:HAS_CHUNK]->(Chunk)-[:MENTIONS]->(Entity)-[:RELATED_TO]->(Entity)`
   - **孤儿清理**：删除文档时，自动删除失去任何引用的孤立实体节点，防止图膨胀。
4. **接入发布三管道**：
   - `publisher.afterPublish` 同时投递 `RAG + Search + KG`。
   - `publisher.afterUnpublish` 同时广播清理三路索引。

---

## v6 分支：企业级文档状态机与多级审批流 (Review & Status Machine)

### 1. 状态流转机制与业务规则

```text
       ┌───────────【驳回 (reject)】────────────┐
       ▼                                       │
  [0 草稿 (Draft)] ───【提审 / publish】───► [3 待审核 (PendingReview)]
                                               │
                                       【通过 (approve)】
                                               │
                                               ▼
  [2 已归档 (Archived)] ◄──【归档 (archive)】── [1 已发布 (Published)]
       │                                       │
       └───────────【保存草稿 (save-draft)】────┘
```

#### 核心逻辑规则：
1. **状态定义**：
   - `0 Draft`：草稿，不可检索。
   - `1 Published`：已发布，写入 RAG / Search / KG 三管道索引。
   - `2 Archived`：已归档，清理全部索引，保留正文。
   - `3 PendingReview`：待审核，不可检索，**且锁定正文禁止编辑**。
2. **审批联动索引**：
   - 调用 `publish` 时，若开启审核（`DOCUMENT_REQUIRE_APPROVAL=true`），进入待审核状态，**暂不建索引**。
   - 只有审核员调用 `approve` 通过后，文档才变为 `Published (1)`，**此时才触发投递三管道索引**！
   - 若已发布文档再次修改提审，会先下架清理旧索引，审核通过后再建立新索引。

### 2. 改造流程与开发步骤
1. **PostgreSQL 建表与实体**：
   - 执行 SQL 创建 `kh_document_review` 表。
   - 创建 `DocumentReviewEntity`。
2. **状态机规范定义 (`document-status.ts`)**：
   - 定义 `DocumentStatus` 枚举与 `canPublishFrom`, `canEditContent`, `canArchive`, `canSubmitReview` 守卫函数。
3. **审核核心服务 (`DocumentReviewService`)**：
   - `submitForReview(documentId)`：提审校验，生成待审记录，置 `PendingReview`。
   - `approveReview(reviewId, reviewer...)`：标记通过，置 `Published`，**调用 `pipelinePublisher.afterPublish` 触发三管道索引**。
   - `rejectReview(reviewId, comment...)`：标记驳回与意见，置 `Draft`。
   - `listTasks()` 与 `getPendingCount()`：支持分页查询待审列表与角标计数。
4. **改造 Controller 与 Service**：
   - 在 `DocumentService.publish` 内部接入审核判断。
   - 新增端点：
     - `GET /documents/reviews/tasks`（待办列表）
     - `GET /documents/reviews/tasks/pending-count`（待办角标）
     - `POST /documents/reviews/tasks/:taskId/approve`（审核通过）
     - `POST /documents/reviews/tasks/:taskId/reject`（审核驳回）
     - `PUT /documents/:id/archive`（归档并清索引）
     - `PUT /documents/:id/save-draft`（下架并清索引）
     - `GET /documents/:id/reviews/history`（查看历史流转）

---

## v7 分支：JWT 用户认证与基于角色的权限控制 (RBAC)

### 1. 核心定位与业务场景
为全站提供统一身份认证与基于角色访问控制（RBAC），杜绝接口参数伪造身份或越权审核。

```text
                                  【客户端请求】
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │ 全局守卫 1: JwtAuthGuard          │
                     │ (校验 Authorization: Bearer Token) │
                     │  - 标记了 @Public() 的接口直接放行 │
                     └─────────────────┬─────────────────┘
                                       │ 校验通过，注入 req.user
                                       ▼
                     ┌───────────────────────────────────┐
                     │ 全局守卫 2: RolesGuard            │
                     │ (校验用户是否具备 @Roles(...) 权限)│
                     │  - 如审核接口要求 ROLE_REVIEWER   │
                     └─────────────────┬─────────────────┘
                                       │ 角色通过
                                       ▼
                              【业务 Controller】
          (@CurrentUser() 自动提取 authorId / reviewerId，无需前端传)
```

### 2. 核心改动点
1. **全局受保护与白名单机制**：
   - 默认所有接口均受 `JwtAuthGuard` 拦截，必须提供有效 Bearer Token。
   - 登录 (`POST /auth/login`)、注册 (`POST /auth/register`) 标注 `@Public()` 白名单。
2. **自动注入身份**：
   - 创建文档与上传解析时，`authorId` / `createBy` 由当前登录用户 Token 自动提供，防止前端恶意篡改。
3. **权限角色隔离**：
   - 审核员工作台（`/reviews/tasks`）、通过 (`approve`)、驳回 (`reject`) 接口强制打上 `@Roles('ROLE_REVIEWER', 'ROLE_ADMIN')` 守卫，普通用户访问直接响应 `403 Forbidden`。

### 3. 改造流程与开发步骤
1. **安装认证依赖**：
   ```bash
   pnpm add @nestjs/jwt @nestjs/passport passport passport-jwt bcryptjs
   pnpm add -D @types/passport-jwt @types/bcryptjs
   ```
2. **Postgres 建表与初始账号**：
   - 创建 `kh_user`（用户表，密码使用 bcrypt 哈希）。
   - 创建 `kh_role`（预置 `ROLE_ADMIN`、`ROLE_REVIEWER`、`ROLE_USER`）。
   - 创建 `kh_user_role`（用户与角色多对多映射）。
   - 初始化预置账号：`admin/123456`, `reviewer/123456`, `user/123456`。
3. **开发用户模块 (`src/user/`) 与角色常量**：
   - `src/common/constants/roles.ts`：定义常量编码。
   - `UserEntity`, `RoleEntity`, `UserRoleEntity`。
   - `UserService`：提供根据 username 查用户、校验密码与获取角色数组。
4. **开发 Auth 鉴权模块 (`src/auth/`)**：
   - `JwtStrategy`：提取请求头 `Authorization: Bearer <token>` 并解密为 `AuthUser`。
   - `JwtAuthGuard`：配合 `@Public()` 装饰器实现全局放行判定。
   - `RolesGuard`：配合 `@Roles()` 装饰器校验当前用户角色。
   - `@CurrentUser()`：自定义参数装饰器，直接获取 `req.user`。
   - `AuthService`：`login` 校验密码并生成 JWT。
   - `AuthController`：暴露 `/auth/login`, `/auth/register`, `/auth/me`。
5. **在 `AppModule` 注册全局守卫**：
   ```typescript
   providers: [
     { provide: APP_GUARD, useClass: JwtAuthGuard },
     { provide: APP_GUARD, useClass: RolesGuard },
   ]
   ```
6. **改造 `DocumentController`**：
   - `create` 与 `uploadAndParse` 接入 `@CurrentUser() user: AuthUser`，移除前端手填 `authorId`。
   - 审核相关接口加入 `@Roles(RoleCode.REVIEWER, RoleCode.ADMIN)` 守卫，自动绑定 `reviewerId = user.userId`。

---

## v8 分支：用户与角色全生命周期管理、Redis 缓存与邮件安全服务

### 1. 核心定位与业务场景
在 v7 基础登录与守卫之上，构建完整的企业级**用户/角色全生命周期管理后台 (User/Role Admin)**、**个人中心与统计**，并接入 **Redis 7.0 缓存层** 与 **SMTP 邮件发送服务**，提供**邮箱激活**与**验证码忘记密码重置**能力。

```text
                               【客户端请求】
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
  1. 账户安全与邮件流            2. 用户管理 (User)          3. 角色管理 (Role)
  ┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
  │ - 邮箱激活 Token     │    │ - 管理员: 用户 CRUD   │    │ - 管理员: 角色 CRUD   │
  │ - 忘记密码: 6位验证码 │    │   (分页/启禁用/分角色) │    │   (列表/新增/改/删)   │
  │ - 邮件发送 (Nodemailer)│   │ - 个人中心:           │    │ - 绑定校验 (防止误删) │
  └──────────┬───────────┘    │   资料/修改密码/数据统计 │    └──────────────────────┘
             │                └──────────────────────┘
             ▼
     【Redis 7.0 缓存层】
     (存储 Token 24h / 验证码 10min)
```

### 2. 核心改动点
1. **Redis 缓存层引入**：
   - 接入 Redis 7.alpine 容器与 RedisInsight 可视化后台。
   - 封装全局 `RedisService`（提供 `get`, `set`, `setEx`, `del` 操作）。
2. **SMTP 邮件发送与账户安全 (`EmailService`)**：
   - 集成 `@nestjs-modules/mailer` 与 `nodemailer`。
   - **邮箱激活流 (`EmailActivationService`)**：配置 `REQUIRE_EMAIL_VERIFICATION=true` 时，新注册用户状态为未激活(0)，生成 24 小时有效的激活 Token 写入 Redis，发送激活链接邮件。
   - **忘记密码重置流 (`PasswordResetService`)**：输入邮箱获取 6 位数字验证码（Redis 10分钟有效期），校验验证码后完成新密码重置。
3. **角色管理全流程 (Role CRUD)**：
   - 管理员专用接口 (`@Roles(RoleCode.ADMIN)`)：角色列表、新增角色、修改角色信息。
   - **防误删保护机制**：删除角色前检查是否仍有用户绑定该角色，有绑定则拒绝删除。
4. **用户管理全流程 (User Admin & Profile)**：
   - **管理员工作台 (`UserController`)**：用户分页综合检索（状态/角色/关键字模糊匹配）、管理员直接新建用户并分配角色、启用/禁用用户、批量分配角色、重置用户密码、软删除用户。
   - **个人中心**：获取本人资料 (`/me/profile`)、修改姓名/头像、修改密码 (`/me/password` 校验原密码)、个人知识库数据统计 (`/me/stats` 统计名下文档数、已发布数、待审核数等)。

### 3. 改造流程与开发步骤
1. **安装依赖**：
   ```bash
   pnpm add ioredis @nestjs-modules/mailer nodemailer
   pnpm add -D @types/nodemailer
   ```
2. **Docker 与环境配置**：
   - 在 `docker-compose.yml` 中启动 `redis` (端口 6379) 与 `redisinsight` (端口 5540)。
   - 在 `.env` 中配置 `REDIS_HOST`, `REDIS_PORT`, `MAIL_HOST`, `MAIL_USER`, `MAIL_PASS` 等。
3. **封装全局 Redis 模块 (`src/redis/`)**：
   - 创建 `RedisService`（基于 ioredis 客户端封装，支持 `setEx` 过期时间写入）。
   - 创建 `RedisModule`（标记为 `@Global()` 并导出）。
4. **开发邮件与安全子服务 (`src/auth/`)**：
   - `email.service.ts`：发送 HTML 格式的激活邮件与密码重置验证码邮件。
   - `email-activation.service.ts`：生成并校验 Redis 中的激活 Token（24h）。
   - `password-reset.service.ts`：生成并消费 Redis 中的 6 位重置验证码（10min）。
5. **完善 AuthController 端点**：
   - `GET /auth/verify-email?token=...`（邮箱激活链接）。
   - `POST /auth/password/reset/send-code`（发送重置验证码）。
   - `POST /auth/password/reset`（重置密码）。
   - `POST /auth/logout`（登出）。
6. **开发角色服务与控制器 (`src/user/`)**：
   - `role.service.ts`：角色增删改查 + 用户绑定依赖检查。
   - `role.controller.ts`：前缀 `/roles`，全部路由受 `@Roles(RoleCode.ADMIN)` 保护。
7. **开发用户服务与控制器 (`src/user/`)**：
   - 创建 DTO：`QueryUserDto`, `CreateUserDto`, `UpdateUserDto`, `AssignRolesDto`, `ChangePasswordDto`, `ProfileDto`。
   - 扩展 `user.service.ts`：实现分页列表、状态变更、管理员重置密码、个人数据统计（文档数聚合）。
   - `user.controller.ts`：暴露管理员管理端点与普通用户个人中心端点。
8. **AppModule 注册 MailerModule**：
   - 在 `AppModule` 引入 `MailerModule.forRootAsync` 配置 SMTP 连接池。

---

## 快速联调与测试命令对照表

### 1. 登录认证与获取 Token
```bash
export BASE=http://localhost:3000

# 普通用户登录
USER_TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"user","password":"123456"}' | jq -r '.accessToken')

# 审核员登录
REVIEWER_TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"reviewer","password":"123456"}' | jq -r '.accessToken')

# 管理员登录
ADMIN_TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"123456"}' | jq -r '.accessToken')
```

### 2. 角色管理测试 (管理员)
```bash
# 查询角色列表
curl -s "$BASE/roles/list" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# 创建新角色
curl -s -X POST "$BASE/roles" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"roleName":"内容运营","roleCode":"ROLE_OPERATOR","description":"内容维护"}' | jq
```

### 3. 用户管理测试 (管理员)
```bash
# 分页查询用户（带关键字与角色筛选）
curl -s "$BASE/users?page=1&pageSize=10&keyword=李四" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# 管理员创建用户并分配角色
curl -s -X POST "$BASE/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"username":"editor01","password":"123456","realName":"编辑小王","roleCodes":["ROLE_USER"]}' | jq

# 禁用用户
USER_ID='替换成用户 ID'
curl -s -X PUT "$BASE/users/${USER_ID}/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status": 0}' | jq
```

### 4. 个人中心测试 (普通用户)
```bash
# 查询本人个人资料
curl -s "$BASE/users/me/profile" \
  -H "Authorization: Bearer $USER_TOKEN" | jq

# 查询本人知识库统计数据
curl -s "$BASE/users/me/stats" \
  -H "Authorization: Bearer $USER_TOKEN" | jq

# 修改本人密码
curl -s -X PUT "$BASE/users/me/password" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"oldPassword":"123456","newPassword":"newpassword123"}' | jq
```

### 5. 密码重置流测试 (Redis 验证码)
```bash
# 1. 发送 6 位邮箱验证码（存 Redis 10分钟）
curl -s -X POST "$BASE/auth/password/reset/send-code" \
  -H 'Content-Type: application/json' \
  -d '{"email":"your_email@domain.com"}' | jq

# 2. 提交验证码与新密码
curl -s -X POST "$BASE/auth/password/reset" \
  -H 'Content-Type: application/json' \
  -d '{"email":"your_email@domain.com","code":"123456","newPassword":"newpassword666"}' | jq
```

### 6. 文档发布与审核流测试
```bash
# 上传创建草稿
DOC_RESP=$(curl -s -X POST "$BASE/documents/upload/parse" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -F 'file=@./test-files/01-travel-expense-policy.pdf' \
  -F 'tags=差旅,SOP')
DOC_ID=$(echo $DOC_RESP | jq -r '.documentId')

# 普通用户提交审核
curl -s -X PUT "$BASE/documents/${DOC_ID}/publish" \
  -H "Authorization: Bearer $USER_TOKEN" | jq '{id, status}'

# 审核员审核通过（触发 RAG/Search/KG 索引）
TASK_ID=$(curl -s "$BASE/documents/reviews/tasks?status=pending" \
  -H "Authorization: Bearer $REVIEWER_TOKEN" | jq -r '.items[0].id')
curl -s -X POST "$BASE/documents/reviews/tasks/${TASK_ID}/approve" \
  -H "Authorization: Bearer $REVIEWER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reviewComment": "符合要求准予发布"}' | jq '{id, status, publishTime}'
```

### 7. 后台服务管理端验证
- **RedisInsight 可视化后台**：`http://localhost:5540`
- **RabbitMQ 消息队列面板**：`http://localhost:15672` (guest / guest)
- **ES 向量切片索引查询**：`GET /kh_chunk/_search`
- **ES 全文快照索引查询**：`GET /kh_document/_search`
- **Neo4j 知识图谱控制台**：`http://localhost:7474` (neo4j / 12345678)

---

## 8. 注册流程业务改造（国内主流邮箱验证码模式）

针对原有“先入库为未激活状态，后发邮件激活链接”容易被恶意滥用、产生未验证脏数据的问题，已优化为**国内主流的“先发验证码 -> 验证成功才入库”模式**：

### 核心改进点
1. **彻底杜绝无效垃圾数据**：
   - 只有当用户输入的 6 位验证码校验正确无误时，才会执行落库逻辑。
   - 用户入库后状态直接为激活状态（`status = 1, emailVerified = 1`），无缝即可登录。
2. **防刷与安全控制**：
   - Redis 缓存验证码 Key 命名：`email:register:code:${email}`。
   - **有效时间（TTL）**：10 分钟（600 秒）。
   - **防刷冷却机制**：同一邮箱 60 秒内禁止重复发送（校验 Redis 剩余 TTL > 540 秒时拦截请求）。
   - **防重复利用**：注册成功后，立即消费并删除 Redis 验证码。
3. **改造涉及文件清单**：
   - `src/auth/dto/auth.dto.ts`：新增 `SendRegisterCodeDto`；`RegisterDto` 将 `email` 与 `code`（6 位数字）设为必填。
   - `src/auth/register-code.service.ts`：实现基于 Redis 的验证码存储、防刷 TTL 查询、校验与删除。
   - `src/auth/email.service.ts`：新增 `sendRegisterCodeEmail(email, code)` 邮件模板。
   - `src/auth/auth.controller.ts`：新增开放端点 `POST /auth/register/send-code`。
   - `src/auth/auth.service.ts`：实现 `sendRegisterCode`（查重、防刷、生码、存 Redis、发邮件）与重构 `register`（先比对 Redis 验证码，成功后写入数据库）。
   - `src/auth/auth.module.ts`：在 providers 中注入 `RegisterCodeService`。
   - `curl-auth.md`：同步更新注册接口测试指南。

---

## 9. v8 -> v9 分支升级改造指南（RBAC 细粒度权限与团队 Team 模块）

### 9.1 改造背景与核心目标
在 v8 阶段，系统仅具备粗粒度的角色守卫（`ROLE_ADMIN` / `ROLE_REVIEWER` / `ROLE_USER`），无法支撑“菜单/按钮/接口级权限控制”以及“企业组织架构/团队协作”。
**v9 的核心目标**：
1. **细粒度权限控制（Permission RBAC）**：
   - 支持权限树（菜单、按钮、接口三类权限）。
   - 支持双重授权模型：**角色绑定权限（Role-Permission）** + **用户直接绑定特殊权限（User-Permission）**。
   - 实现 `@RequirePermission(...)` 装饰器与全局 `PermissionsGuard`，在 JWT 登录后自动汇聚用户的“角色权限 + 直接权限”，支持超级管理员自动放行。
2. **企业组织团队架构（Team 模块）**：
   - 支持无限级树形团队组织结构（`kh_team`）。
   - 支持团队成员与成员角色管理（`leader` / `member`）。

---

### 9.2 涉及变动的文件清单总览

| 模块 | 变更类型 | 文件路径 | 核心职责 |
|------|----------|----------|----------|
| **SQL 脚本** | 修改 | `init-scripts/postgresql/init.sql` | 新增 `kh_permission`, `kh_role_permission`, `kh_user_permission`, `kh_team`, `kh_team_member` 表及初始化数据 |
| **常量定义** | 新增 | `src/common/constants/permissions.ts` | 定义权限常量、权限类型枚举 `PermissionType`、管理员默认操作权限清单 |
| **Auth 模块** | 修改 | `src/auth/auth-user.interface.ts` | `AuthUser` 接口增加 `permissions: string[]` 字段 |
| **Auth 模块** | 新增 | `src/auth/decorators/require-permission.decorator.ts` | 声明式权限装饰器 `@RequirePermission(...perms)` |
| **Auth 模块** | 新增 | `src/auth/permissions.guard.ts` | 细粒度权限校验守卫（优先级在 JWT 守卫之后） |
| **Auth 模块** | 修改 | `src/auth/auth.module.ts` | 注册 `PermissionsGuard` 为全局 `APP_GUARD` |
| **User 模块** | 新增 | `src/user/entities/permission.entity.ts` | 权限实体映射 (`kh_permission`) |
| **User 模块** | 新增 | `src/user/entities/role-permission.entity.ts` | 角色-权限关联实体 (`kh_role_permission`) |
| **User 模块** | 新增 | `src/user/entities/user-permission.entity.ts` | 用户-权限关联实体 (`kh_user_permission`) |
| **User 模块** | 新增 | `src/user/dto/permission.dto.ts` | 权限 CRUD、分页查询、角色/用户分配权限入参 DTO |
| **User 模块** | 新增 | `src/user/permission.service.ts` | 权限树组装、权限分配逻辑、用户多源权限聚合算法 |
| **User 模块** | 新增 | `src/user/permission.controller.ts` | 暴露 `/permissions` 路由（CRUD、树形接口、分页） |
| **User 模块** | 修改 | `src/user/user.service.ts` | 注入 `PermissionService`，生成 `AuthUser` 时聚合角色权限与直接权限 |
| **User 模块** | 修改 | `src/user/user.controller.ts` | 增加用户直接权限查询与分配端点 |
| **User 模块** | 修改 | `src/user/role.controller.ts` | 增加角色权限查询与分配端点 |
| **User 模块** | 修改 | `src/user/user.module.ts` | 注册 3 个新 Entity、Service 与 Controller，并导出 `PermissionService` |
| **Team 模块** | 新建目录 | `src/team/entities/team.entity.ts` | 团队实体映射 (`kh_team`) |
| **Team 模块** | 新建 | `src/team/entities/team-member.entity.ts` | 团队成员实体 (`kh_team_member`) |
| **Team 模块** | 新建 | `src/team/dto/team.dto.ts` | 团队 CRUD、成员增删 DTO |
| **Team 模块** | 新建 | `src/team/team.service.ts` | 团队树构造、团队管理及成员管理业务逻辑 |
| **Team 模块** | 新建 | `src/team/team.controller.ts` | 暴露 `/teams` 路由端点 |
| **Team 模块** | 新建 | `src/team/team.module.ts` | 封装 Team 模块 |
| **主模块** | 修改 | `src/app.module.ts` | 注册 Team 实体并在 `imports` 中引入 `TeamModule` |
| **文档** | 新增 | `curl-rbac.md` | RBAC 细粒度权限及团队模块的完整 curl 测试指令集合 |

---

### 9.3 核心设计实现细节

#### 1. 权限树与多源权限聚合逻辑
用户拥有的最终权限编码列表 = **所属所有角色的权限集合 ∪ 用户被直接赋予的特殊权限集合**：
```ts
// src/user/permission.service.ts 核心算法
async getUserPermissionCodes(userId: string): Promise<string[]> {
  // 1. 查询用户直接分配的权限
  const directPerms = await this.userPermRepo.find({ where: { userId } });
  
  // 2. 查询用户所属角色分配的权限
  const userRoles = await this.userRoleRepo.find({ where: { userId } });
  const roleIds = userRoles.map(r => r.roleId);
  const rolePerms = roleIds.length > 0 
    ? await this.rolePermRepo.find({ where: { roleId: In(roleIds) } }) 
    : [];

  // 3. 去重合并权限 ID，并批量拉取启用状态的 permission_code
  const allPermIds = Array.from(new Set([...directPerms.map(p => p.permissionId), ...rolePerms.map(p => p.permissionId)]));
  if (!allPermIds.length) return [];

  const entities = await this.permRepo.find({
    where: { id: In(allPermIds), status: 1, deleted: false },
    select: [permissionCode],
  });
  return entities.map(e => e.permissionCode);
}
```

#### 2. PermissionsGuard 声明式守卫
在每个需要细粒度权限保护的 Controller 方法上添加 `@RequirePermission(system:user)`：
- 若用户包含 `ROLE_ADMIN` 角色，守卫自动放行（超级管理员具备全局通配特权）。
- 否则检查 `request.user.permissions` 是否包含该方法所需的任意一个权限码。
- 未命中的直接抛出 `ForbiddenException(权限不足)`。

---

## 10. v9 -> v10 分支升级改造指南（全文检索与知识图谱服务化、异步管线全量索引与操作人审计）

### 10.1 改造背景与核心目标
在 v9 阶段，系统具备了 RBAC 细粒度权限控制与组织架构，但存在以下痛点：
1. **ES 搜索与 Neo4j 图谱未服务化**：写入了数据却没有对外的查询/检索 API，前端无法使用搜索和图谱可视化。
2. **MQ 索引消息过大与正文截断**：之前发布文档时将正文前 1000 字塞进 MQ 消息中，既导致 MQ 消息体庞大，又导致长文章全文无法被完整检索。
3. **审计漏洞**：之前接口允许前端自行传入 `authorId`、`createBy` 等，容易造成越权冒用。

**v10 的核心目标**：
1. **全新暴露 `SearchModule`**：提供 `POST /search` 接口，基于 Elasticsearch IK 中文分词（写入 `ik_max_word`，检索 `ik_smart`）与多字段加权匹配（`title^3`, `summary^2`, `content`），支持关键词搜索与 `<em>` 高亮片段。
2. **全新暴露 `GraphModule`**：提供 `GET /graph/search`、`GET /graph/nodes`、`GET /graph/edges` 接口，支持 Neo4j 实体、文档、切片节点查询与跨文档关联网络查询。
3. **异步管线与 MQ 消息瘦身重构**：MQ 消息仅投递 `documentId`，由消费者异步从 Postgres + Mongo 读取完整正文入库 ES，实现“零截断全量索引 + MQ 轻量化”。
4. **安全与操作人审计强化**：DTO 移除前端传入的 `authorId` / `createBy`，统一从 JWT 登录态自动获取并记录 `updateBy`，结合 `@RequirePermission()` 实施细粒度权限校验。

---

### 10.2 涉及变动的文件清单总览

| 模块分类 | 变更类型 | 文件路径 | 核心职责 |
| :--- | :---: | :--- | :--- |
| **常量与 SQL** | 修改 | `src/common/constants/permissions.ts` | 新增 `PermissionCode` 常量字典（包含 `search` 权限码） |
| | 修改 | `init-scripts/postgresql/init.sql` | 为普通用户与审核员角色追加搜索及文档编辑权限 |
| **检索模块** | 新建 | `src/search/dto/search.dto.ts` | 全文搜索请求 DTO（关键词、分页、分类/作者过滤） |
| | 新建 | `src/search/search.controller.ts` | 暴露 `POST /search` 端点，受 `@RequirePermission(PermissionCode.search)` 保护 |
| | 新建 | `src/search/search.module.ts` | 封装检索模块，引入 `PipelineModule` |
| **图谱模块** | 新建 | `src/graph/dto/graph-query.dto.ts` | 图谱节点、边与关键字搜索请求 DTO |
| | 新建 | `src/graph/graph.controller.ts` | 暴露 `GET /graph/search`、`/nodes`、`/edges` 端点 |
| | 新建 | `src/graph/graph.module.ts` | 封装图谱模块，引入 `PipelineModule` |
| **管线引擎** | 修改 | `src/pipeline/search-index.service.ts` | 实现 `searchDocuments` 高亮多字段打分检索算法，配置 IK 中文分析器 |
| | 修改 | `src/pipeline/graph-build.service.ts` | 实现 `listNodes`、`listEdges`、`searchGraph` 查询 Neo4j 知识实体与关联关系 |
| | 修改 | `src/pipeline/pipeline.orchestrator.ts` | 消费端重构为根据 `documentId` 自动聚合 Postgres 元数据与 Mongo 正文 |
| | 修改 | `src/pipeline/pipeline.module.ts` | 导出 `EmbeddingService` 供外部可能调用 |
| **MQ 异步消息** | 修改 | `src/mq/messages/pipeline.messages.ts` | `SearchIndexMessage` 结构精简，移除直接内嵌的 `document` 快照 |
| | 修改 | `src/mq/document-pipeline.publisher.ts` | `triggerSearchIndex` 仅投递 `documentId`，移除 1000 字正文截断限制 |
| | 修改 | `src/mq/document-pipeline.consumer.ts` | 调整参数调用消费逻辑 |
| **文档模块** | 修改 | `src/document/dto/create-document.dto.ts` | 移除前端传入的 `authorId`, `createBy` |
| | 修改 | `src/document/dto/update-document.dto.ts` | 移除前端传入的 `updateBy` |
| | 修改 | `src/document/dto/upload-parse.dto.ts` | 移除解析表单传入的作者与创建人字段 |
| | 修改 | `src/document/document.service.ts` | 方法入参传入 `actor: AuthUser`，发布/删除/更新自动审计操作人，移除正文冗余传参 |
| | 修改 | `src/document/document-review.service.ts` | 审核流记录操作人员 ID |
| | 修改 | `src/document/document.controller.ts` | 端点补充 `@RequirePermission()` 细粒度权限控制，从当前用户注入 `actor` |
| **全局主模块** | 修改 | `src/app.module.ts` | 注册引入 `SearchModule` 与 `GraphModule` |
| **测试文档** | 新建 | `curl-read.md` | 全流程：上传 PDF -> 审核发布 -> MQ 异步入库 -> ES 全文搜索与 Neo4j 图谱检索 |

---

## 11. v10 -> v11 分支升级改造指南（企业级 Hybrid RAG 混合检索、文本重排 Reranker 与智能问答 Chat）

### 11.1 改造背景与核心目标
在 v10 阶段，系统具备了基于 ES 的“整篇文档全文搜索”与基于 Neo4j 的“图谱检索”，但**尚未形成面向知识问答的端到端 RAG 闭环**：
1. **单一检索召回率低**：仅靠向量检索（Dense）容易漏掉精确的专有名词、错误码、工单号；仅靠关键词检索（Sparse）无法理解同义词和语义关联。
2. **缺乏二次精排**：粗排检索出的块分数不在同一尺度，直接塞给 LLM 容易造成“迷失在中间（Lost in the middle）”和幻觉。
3. **缺乏智能回答与精准引用溯源**：前端需要问答结果，同时必须知道回答每一句话引自哪个文档的哪个段落。

**v11 的核心目标**：
1. **实现 Dual-Channel 混合检索（Hybrid Search）**：
   - 稠密检索：`knnSearch` 基于 `kh_chunk` 索引的 `dense_vector`（1024 维）做余弦相似度（Cosine）召回。
   - 稀疏检索：`keywordSearch` 基于 `kh_chunk` 的正文与标题做 BM25 词法召回（IK 中文分词）。
   - 粗排融合：基于 **RRF（Reciprocal Rank Fusion 倒数排名融合算法）** 无量纲融合双路排名，得出最优候选集。
2. **集成 Cross-Encoder 文本重排（RerankerService）**：
   - 接入工业界主流的文本重排服务（如 DashScope `qwen3-rerank`），对 RRF 候选块打出绝对相关度评分（0~1）。
   - 内置平滑降级：在未配置 API Key 或网络波动时，自动回退到 RRF 得分排序，保证高可用。
3. **RAG 智能对话与可信引用（AiChatService）**：
   - 组装知识上下文，注入 Prompt 约束大模型“仅依据提供的材料回答，不知则言不知”；
   - 自动在回答句子结尾标注资料编号（如 `[1]`, `[2]`）；
   - 正则自动抽取引用标记，过滤出真实被参考的段落切片作为溯源信息返回。

---

### 11.2 涉及变动的文件清单总览

| 模块分类 | 变更类型 | 文件路径 | 核心职责 |
| :--- | :---: | :--- | :--- |
| **管道层类型** | 修改 | `src/pipeline/types/pipeline.types.ts` | 新增 `ChunkHit` 检索命中结果接口 |
| **向量检索服务** | 修改 | `src/pipeline/vector-index.service.ts` | 实现 `keywordSearch`、`knnSearch`、`searchHybrid`、`rrfFuse`；`kh_chunk` 启用 IK 分词 |
| **文档检索服务** | 修改 | `src/pipeline/search-index.service.ts` | 索引初始化逻辑微调 |
| **AI 模块 DTO** | 新建 | `src/ai/dto/chat.dto.ts` | RAG 问答请求入参（`content`, `topK`） |
| | 新建 | `src/ai/dto/rag-search.dto.ts` | 仅混合检索不问答请求入参（`query`, `topK`） |
| **AI 重排服务** | 新建 | `src/ai/reranker.service.ts` | 接入 `qwen3-rerank` 文本重排，支持多 Key 兼容与自动降级 |
| **AI 检索服务** | 新建 | `src/ai/hybrid-retrieval.service.ts` | 编排查询向量化、ES 双路混合召回、RRF 融合与重排切片 |
| **AI 问答服务** | 新建 | `src/ai/ai-chat.service.ts` | 知识上下文拼装、LangChain 提示词驱动、回答生成与引用溯源提取 |
| **AI 控制器** | 新建 | `src/ai/ai.controller.ts` | 暴露 `POST /rag/search` 与 `POST /ai/chat` 端点 |
| **AI 模块封装** | 新建 | `src/ai/ai.module.ts` | 组装 AI 模块依赖，引入 `PipelineModule` |
| **全局主模块** | 修改 | `src/app.module.ts` | 引入并注册 `AiModule` |
| **测试测试集** | 新建 | `test-files/rag-canary.json` | 灰度发布测试文档 |
| | 新建 | `test-files/rag-onboarding.json` | 入职指南测试文档 |
| | 新建 | `test-files/rag-incident.json` | 故障应急测试文档 |
| | 新建 | `test-files/rag-visibility.json` | 知识库可见性测试文档 |
| **测试文档** | 新建 | `curl-rag.md` | 多文档批量发布、RAG 混合检索验证、智能问答测试文档 |

---

## 十二、从 v11 到 v12：知识图谱全景分析与前端大屏可视化（Graph Overview & CORS）

### 12.1 架构演进与核心目标
在 v11 完成了 RAG 混合检索与引用溯源问答之后，v12 聚焦于**知识图谱全景检索、多维统计聚合与前端力导向图可视化大屏支撑**：
1. **全局启用 CORS 跨域支持**：
   - 在应用入口 `src/main.ts` 中配置 `app.enableCors({ origin: true, credentials: true })`，打通前端知识图谱大屏与前端独立站点的跨域调用。
2. **文档标签与图谱双向联动**：
   - 在文档图谱构建阶段（`buildDocumentGraph`），将 `KnowledgeDocument` 节点的 `tags` 属性同步写入 Neo4j，支持后续基于多标签切分、聚类与关联。
3. **高性能全景图检索与多维聚合（getOverview）**：
   - **多条件联合过滤**：支持关键词匹配（文档标题/摘要/标签/实体名称/描述）、实体类型过滤（`entityType`）、时间范围限定（`from` ~ `to`）和文档拉取条数控制（`docLimit`，默认 24，最大 80）。
   - **全库宏观统计（stats）**：分段 `OPTIONAL MATCH ... WITH` 计算文档数、实体数、RELATED_TO 关联边数、MENTIONS 提及关系数，并聚合各实体类型的分布占比。
   - **Top 核心实体与最近更新看板**：
     - 计算被提及次数（度数 degree）最高的 Top 5 核心实体；
     - 检索最新更新的 8 篇文档节点作为最近动态。
   - **三元组与实体关联局部诱导子图构建**：
     - 构造三类画布节点：`document`（文档节点）、`entity`（实体节点）、`tag`（标签节点）；
     - 构造三类边：`mentions`（文档提及实体）、`tagged`（文档标注标签）、`related`（仅查询画布上实体之间的 `RELATED_TO` 边，上限 400，避免拉取全库边导致前端力导向图崩溃）。

---

### 12.2 涉及变动的文件清单总览

| 模块分类 | 变更类型 | 文件路径 | 核心职责 |
| :--- | :---: | :--- | :--- |
| **全局入口** | 修改 | `src/main.ts` | 开启 `app.enableCors` 跨域支持 |
| **图谱模块 DTO** | 修改 | `src/graph/dto/graph-query.dto.ts` | 新增 `GraphOverviewDto` 查询参数类 |
| **图谱控制器** | 修改 | `src/graph/graph.controller.ts` | 新增 `GET /graph/overview` 全景接口 |
| **图谱构建服务** | 修改 | `src/pipeline/graph-build.service.ts` | 节点增加 `tags` 写入，实现 `getOverview` 全景多维检索与统计方法 |

