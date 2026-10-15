# 用户鉴权测试 curl

注册采用**国内主流模式：先发邮箱验证码（Redis 缓存 10 分钟，60s 防刷冷却） -> 提交注册信息与验证码 -> 验证通过后直接落库激活**。
文档接口默认需 JWT；审核接口需 `ROLE_REVIEWER` 或 `ROLE_ADMIN`。

## 预置测试账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | 123456 | 管理员 + 审核员 |
| reviewer | 123456 | 审核员 |
| user | 123456 | 普通用户 |

> 全新库：删除 Postgres 数据卷后 `docker compose up -d`，`init.sql` 会自动建表并插入上述账号。

```bash
export BASE=http://localhost:3000
```

---

## 1. 登录

```bash
curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"liwk","password":"123456"}' | jq
```

```bash
TOKEN='替换成 accessToken'
```

审核员登录（用于 approve/reject）：

```bash
curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"reviewer","password":"123456"}' | jq '{accessToken, userInfo}'
```

```bash
REVIEWER_TOKEN='替换成 reviewer 的 accessToken'
```

---

## 2. 当前用户

```bash
curl -s "$BASE/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 3. 注册新用户（验证码模式，默认 ROLE_USER）

### 步骤 1：发送注册验证码至邮箱
验证码 10 分钟有效，同一邮箱 60 秒内防重复点击。

```bash
curl -s -X POST "$BASE/auth/register/send-code" \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "1364848261@qq.com"
  }' | jq
```
*提示：可查收邮件，或使用 `docker exec -it knowledge-hub-redis redis-cli get "email:register:code:1364848261@qq.com"` 快速查看。*

### 步骤 2：提交注册表单（携带验证码）
验证码校验通过后直接写入数据库（状态为已激活 `status=1`），杜绝垃圾待激活用户。

```bash
curl -s -X POST "$BASE/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "liwk",
    "password": "123456",
    "email": "1364848261@qq.com",
    "code": "473195",
    "realName": "文凯"
  }' | jq
```

注册成功后即可直接使用新账号走上述第 1 步登录接口。

---

## 4. 忘记密码（两步，验证码存 Redis，10 分钟有效）

需配置 `MAIL_*` 与 `REDIS_*`（见 `.env.example`）。

```bash
# 1. 发送验证码
curl -s -X POST "$BASE/auth/password/reset/send-code" \
  -H 'Content-Type: application/json' \
  -d '{"email":"1364848261@qq.com"}' | jq

# 2. 重置密码（邮箱 + 验证码 + 新密码）
curl -s -X POST "$BASE/auth/password/reset" \
  -H 'Content-Type: application/json' \
  -d '{"email":"1364848261@qq.com","code":"749895","newPassword":"654321"}' | jq
```

---

## 5. 刷新 Token

```bash
REFRESH='替换成 login 返回的 refreshToken'

curl -s -X POST "$BASE/auth/refresh" \
  -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\"}" | jq '{accessToken, expiresIn}'
```

---

## 6. 退出登录

```bash
curl -s -X POST "$BASE/auth/logout" \
  -H "Authorization: Bearer $TOKEN" | jq
```

无状态 JWT，服务端仅返回成功；客户端丢弃 accessToken / refreshToken 即可。

---

## 7. 审核员 ID 列表

```bash
curl -s "$BASE/auth/reviewer-ids" \
  -H "Authorization: Bearer $REVIEWER_TOKEN" | jq
```

---

## 8. 带 Token 调用文档接口（示例）

上传 PDF 创建草稿（普通用户）：

```bash
curl -s -X POST "$BASE/documents/upload/parse" \
  -H "Authorization: Bearer $TOKEN" \
  -F 'file=@./test-files/02-production-release-sop.pdf' \
  -F 'tags=审核流测试,SOP' | jq
```

审核通过（需 reviewer/admin token）：

```bash
TASK_ID='替换成待审任务 id'

curl -s -X POST "$BASE/documents/reviews/tasks/${TASK_ID}/approve" \
  -H "Authorization: Bearer $REVIEWER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reviewComment":"内容符合规范，准予发布"}' | jq '{id, status, publishTime}'
```

---

未安装 `jq` 时去掉 `| jq` 即可。

完整文档状态流转见 `curl-document-status.md`。用户/角色/团队管理见 `curl-users.md`。
