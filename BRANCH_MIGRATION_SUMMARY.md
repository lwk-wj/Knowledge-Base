# Knowledge Hub Backend 版本演进与改造全流程实战指南

本文档系统性汇总从 **v1 到 v7** 每个版本的**业务定位、架构图解、完整改造流程、核心代码实现步骤与联调测试方法**，作为各阶段版本迭代升级的实战手册。

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
```

### 2. 携带 Token 上传并发布文档
```bash
# 1. 上传文件创建草稿（身份自动注入）
DOC_RESP=$(curl -s -X POST "$BASE/documents/upload/parse" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -F 'file=@./test-files/01-travel-expense-policy.pdf' \
  -F 'tags=差旅,SOP')
DOC_ID=$(echo $DOC_RESP | jq -r '.documentId')

# 2. 普通用户提交审核（status -> 3 待审核）
curl -s -X PUT "$BASE/documents/${DOC_ID}/publish" \
  -H "Authorization: Bearer $USER_TOKEN" | jq '{id, status}'

# 3. 普通用户尝试查看待办（期望返回 403 Forbidden 权限拦截）
curl -s "$BASE/documents/reviews/tasks?status=pending" \
  -H "Authorization: Bearer $USER_TOKEN" | jq

# 4. 审核员查看待办并获取任务 ID
TASK_ID=$(curl -s "$BASE/documents/reviews/tasks?status=pending" \
  -H "Authorization: Bearer $REVIEWER_TOKEN" | jq -r '.items[0].id')

# 5. 审核员审批通过（文档 status -> 1，触发投递 RAG/Search/KG 三管道建立索引）
curl -s -X POST "$BASE/documents/reviews/tasks/${TASK_ID}/approve" \
  -H "Authorization: Bearer $REVIEWER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reviewComment": "符合要求准予发布"}' | jq '{id, status, publishTime}'

# 6. 归档 / 下架（清空三管道索引）
curl -s -X PUT "$BASE/documents/${DOC_ID}/archive" \
  -H "Authorization: Bearer $USER_TOKEN" | jq '{id, status}'
curl -s -X PUT "$BASE/documents/${DOC_ID}/save-draft" \
  -H "Authorization: Bearer $USER_TOKEN" | jq '{id, status}'
```

### 3. 后台服务管理端验证
- **RabbitMQ 消息队列面板**：`http://localhost:15672` (guest / guest)
- **ES 向量切片索引查询**：`GET /kh_chunk/_search`
- **ES 全文快照索引查询**：`GET /kh_document/_search`
- **Neo4j 知识图谱控制台**：`http://localhost:7474` (neo4j / 12345678)
