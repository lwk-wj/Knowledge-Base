李先生 点击此处联系候选人
期望从事职位：算法工程师
期望工作地点：深圳
基本信息
男 ｜ 28岁(1998年5月) ｜ 3年 ｜ 本科 ｜ 离职-正在找工作
现居住地：深圳 ｜ 户口：九江 ｜ 政治面貌：群众
求职意向
算法工程师 深圳
2万-2.5万/月 ｜ 金融科技/数字金融、技术服务、通信工程/技术... ｜ 全职
算法工程师 深圳
2万-2.5万/月 ｜ 软件/IT服务、人工智能、大数据 ｜ 全职
工作经历
ID：cecmwoZI9AGpNU7aT1s7zsUq7VtOHY1X
简历下载于：2026年07月17日11:09:24
扫码与人才极速沟通
支持: \t微信 \t智联App
点击此处在电脑端查看简历
深圳市方特斯网络科技有限公司 Python
2024.01 - 2026.06 (2年5个月)
工作描述
主导企业级大模型应用从 0 到 1 落地
涵盖 ERP 智能采购、多模态知识库、医疗辅助及金融理财等核心场景。基于 LangGraph 与
DeepAgents 架构，解决多 Agent 协同、长上下文管理及高安全合规等工程化难题，实现业务
流程自动化升级。
Agent 架构与 RAG 底座：设计主 Agent 动态路由与上下文隔离机制，解决 I/O 阻塞；构建“稠
密+稀疏”混合检索架构，结合 SemanticChunker 解决跨页表格断裂，显著提升复杂文档（医学/
金融）召回精度。
全栈集成与记忆管理：基于 FastAPI 封装 SSE 流式交互与 Function Calling；设计
MemoryUpdateMiddleware，结合 MongoDB 与 Redis 实现跨会话长期记忆与用户偏好持久
化。
质量评估与 Token 优化：引入 RAGAS 构建 CorrectiveRAG 双层评估体系，实现低置信度自动

![](http://localhost:9000/knowledge-hub/pdf-images/2026/09/22/pdf_img_p1_0-2b7e48ce-c7b4-4cc2-8907-872962ac519e.png)

![](http://localhost:9000/knowledge-hub/pdf-images/2026/09/22/pdf_img_p1_1-138330a1-1d3d-4e80-bf7b-3d4436d91a27.png)

![](http://localhost:9000/knowledge-hub/pdf-images/2026/09/22/pdf_img_p1_2-49687bdd-4537-49c7-8b75-72117e3ceba0.png)

![](http://localhost:9000/knowledge-hub/pdf-images/2026/09/22/pdf_img_p1_3-d4489751-ac3d-4536-91e5-bde3075c4a3b.png)


项目经历
转人工；通过 MCP 工具合并与渐进式技能系统，大幅压缩 Token 开销并应对长程上下文膨
胀。
安全合规与高可用部署：集成 OpenSandbox 实现文件/进程/网络强隔离；设计双层 HITL 人工
审批与状态持久化机制，保障敏感操作安全；基于 Docker 容器化部署 Milvus 集群，搭建监控
体系保障系统高可用。
前沿探索与跨部门协同：引入 Qwen3-VL-embedding 实现 Any-to-Any 跨模态检索；与产品/后
端团队制定统一 State 规范与接口协议，推动 AI 系统在多业务线的实际落地。
Python \tFASTAPI \tMySQL \tPostgreSQL \tMongoDB
基于Harness架构的ERP智能采购助手项目
2026.04 - 2026.06 (2个月)
项目描述： 随着大模型Agent 从原型验证走向工程化落地，企业级应用面临多Agent 协同、安
全隔离、长期记忆等系统性挑战。本项目基于DeepAgents 框架与Harness 工程架构，面向
ERP智能采购场景，打造了一套覆盖供应商寻源、比价分析、采购申请、订单创建全流程的多
Agent 协同系统。系统集成SSE流式交互与双层人工审批机制，在保障复杂业务安全性的同
时，实现了采购任务的自动化分解与可靠执行。
技术栈：DeepAgents · LangGraph· FastAPI · OpenSandbox· MCP· MongoDB·
CompositeBackend
核心实现与技术突破：
1. 多Agent 协同调度与上下文隔离
设计主Agent 作为任务协调者，基于动态路由将复杂采购任务智能委派至“采购分析Agent”与“采
购订单Agent”。通过子Agent 上下文隔离机制，将中间调用过程与主控逻辑解耦，有效防止长
周期任务中的上下文窗口污染，保障系统稳定运行。
2. 分层安全沙箱与持久化存储
采用OpenSandbox作为底层安全执行环境，实现文件系统、进程与网络的强隔离。结合
CompositeBackend配置三层路由策略：临时文件与代码执行默认路由至沙箱；/memories/
与/persisted-skills/路径则持久化至MongoDB，实现跨会话的用户偏好与技能指令存储。
3. Harness 架构核心能力落地
上下文管理与压缩：利用框架内置机制，实现大型工具输入/结果自动卸载、对话摘要压缩及子
Agent 上下文隔离，有效应对长程任务中的上下文膨胀问题。
渐进式Skills 技能系统：基于DeepAgents 内置的渐进式加载机制，实现技能指令按需加载与持
久化，显著优化Token消耗。
4. MCP工具合并与Token预算优化
针对MCP暴露的多个独立可视化工具导致的上下文膨胀，将其合并为统一入口
generate_visualization，通过chart_type参数动态路由，并结合沙箱内参考文件实现参数按需加
载，大幅压缩工具描述占用的Token开销。
5. 可插拔中间件栈与长期记忆管理
基于框架中间件扩展机制构建多层中间件栈（上下文注入、技能同步、摘要压缩、记忆更新
等），坚持“静默失败优于崩溃”的容错原则，保障Agent 稳定运行。通过

![](http://localhost:9000/knowledge-hub/pdf-images/2026/09/22/pdf_img_p2_0-02d4f922-605c-41f5-8300-56e94edc0a03.png)


MemoryUpdateMiddleware在对话结束后自动提取业务实体并更新至StoreBackend，实现用户
长期偏好记忆。
6. 双层HITL审批与SSE流式交互
基于FastAPI 实现SSE双流模式（messages与values），支持多种事件实时推送。设计双层中
断体系：Schema校验缺失时触发数据补充中断；执行敏感订单操作前触发人工审批中断，确保
业务操作的绝对安全。
7. Agent 懒加载与启动优化
设计_AgentProxy透明代理架构，实现模块导入零开销与同步/异步双路径兼容，有效避免应用
启动时因网络I/O与图编译等初始化耗时造成的阻塞问题。
基于GME模型的多模态RAG知识库项目系统
2026.01 - 2026.04 (3个月)
项目描述： 项目描述：
在实际业务场景中，数据形态往往混杂着文本、图像、表格及图文组合，传统单一模态检索系
统难以满足跨模态查询需求（如“用文字搜图片”或“用图文对搜相关文档”）。本项目构建了一套
统一多模态检索系统，能够将文本、图像及图文对输入转换为对齐的向量表示，支持灵活
的“AnytoAny”跨模态检索（文搜图、图搜文、图文搜图文等），并基于多模态Agent实现RAG响
应的图文联合输出。
技术栈：LangGraph· Milvus · Dots.OCR· RAGAS·Qwen3-VL-embedding·zhipuai · vLLM·
SentenceTransformers
核心实现与技术突破：
1. 统一向量空间下的多模态嵌入与AnytoAny检索
基于多模态嵌入模型，将单文本、单图片及图文对统一映射至同一向量空间，实现跨模态语义
对齐。通过多模态Agent调度RAG流程，确保最终响应同时包含文本与图片，所有模态数据均
在统一向量空间内完成索引与搜索。
2. 高精度文档解析与分块策略
基于小红书开源的Dots.OCR大模型（Transformer架构）进行PDF/PPT文档解析，通过vLLM推
理框架私有化部署，以OpenAI兼容API完成内容提取。图片转换为Base64格式，表格提取为
HTML Table标签。采用章节段落分块+SemanticChunker语义分块相结合的策略，有效解决表
格或内容跨页断裂问题，保证语义完整性。
3. 稠密+稀疏混合检索架构
采用私有化部署的gme-Qwen2-VL-7B-Instruct 多模态嵌入模型（基于Transformers加载），完
成图片与文本的稠密向量化。在Milvus中同时构建稠密向量（Dense）与稀疏向量（Sparse）
索引：
稀疏索引采用DAAT算法，通过调节BM25_k1词频饱和度参数加速查询；
稠密索引设置图构建参数M=30、efConstruction=64，兼顾搜索广度与精度。最终实现“向量语
义匹配+关键词精确匹配”的混合检索能力。
4. 双层记忆系统与上下文工程
基于Redis维护短期对话上下文，每轮交互后通过异步任务将长期记忆向量化存入向量数据库。
短期记忆采用文本摘要压缩，长期记忆则通过“语义+全文”混合检索方式召回，并结合距离阈值
（distance）过滤低相关性内容，保障召回精确度。
5. 两层自适应评估体系（CorrectiveRAG+AdaptiveRAG）
引入RAGAS构建双层质量评估机制：

![](http://localhost:9000/knowledge-hub/pdf-images/2026/09/22/pdf_img_p3_0-c074a39a-df05-4ec4-978d-6659e8e1a772.png)


• 第一层（检索评估）：对知识库召回文档评估Context Precision与Context Recall，未达标则
触发自动重新检索；
• 第二层（生成评估）：在输出答案前评估ResponseRelevancy与Faithfulness。每层均设置信
度阈值，任一环节未通过即转入人工审核流程，确保输出质量可控。
6. 人工介入审批机制（Human-in-the-Loop）
针对多次评估均低于阈值的低置信度结果，集成LangGraph的HITL 能力。通过interrupt函数在
关键节点挂起工作流，由业务人员审核或修正后恢复执行，保障敏感场景下的决策安全与结果
可靠性。
基于DeepSeek-V3模型的RAG医疗文档知识库系统
2025.09 - 2025.12 (3个月)
项目描述： 项目背景：
医疗领域大模型面临知识更新滞后与高幻觉率的双重挑战，传统问答方案准确率仅62%，难以
支撑临床研究人员对精准、可验证信息的需求。本项目构建了一套基于医学论文与临床指南的
RAG增强问答系统，通过实时知识注入与多层质量评估，实现可溯源、高可信的回答生成，有
效提升内部临床研究效率。
技术栈：LangChain· LangGraph· Milvus · UnstructuredLoader · PyMuPDF· DeepSeek-V3·
RAGAS
核心实现与技术突破：
1. 弹性可扩展的向量存储底座
基于Docker 部署Milvus 分布式集群，支持按需弹性扩展节点，为海量医学文档的向量化存储与
高并发检索提供稳定、可水平扩展的基础设施。
2. 高精度医学文档解析与智能分块
针对医学文献格式复杂（含表格、图片、跨页内容）的特点，采用PyMuPDF解析PDF/PPT，
并结合私有化部署的UnstructuredLoader 加载Word、HTML 等非结构化文档：
设置hi_res 策略提取章节层级与表格结构；
集成Tesseract（OCR）提取图片中的文字信息；
采用章节段落分块+SemanticChunker 语义分块相结合的策略，有效解决表格或内容跨页断裂
问题，保障语义完整性。
3. 稠密+稀疏混合检索架构
基于私有化部署的bge-large-zh-v1.5完成Chunk的稠密向量化，结合BM25构建稀疏向量，在
Milvus 中同时创建Dense与Sparse双索引：
稀疏索引采用DAAT算法，通过调节BM25_k1参数控制词频饱和度，加速关键词查询；
稠密索引设置图构建参数M=30、efConstruction=64，兼顾语义搜索的广度与精度。最终实
现“向量语义匹配+关键词精确匹配”的混合检索，显著提升医学文献召回质量。
4. 意图驱动的动态路由工作流
基于LangGraph定制工作流，实现动态路由能力：系统根据用户问题上下文意图，智能分发至
对应知识库（疾病库、药品库、临床指南库）或联网检索通道，确保答案来源的专业性与时效
性。
5. 双层质量评估体系（CorrectiveRAG+AdaptiveRAG）
引入RAGAS构建两层评估机制，全程保障回答可信度：
第一层（检索评估）：对知识库召回文档进行相关性评估，不达标则触发Transform_Query改
写查询并重新检索；

![](http://localhost:9000/knowledge-hub/pdf-images/2026/09/22/pdf_img_p4_0-9b95d0bb-5376-467f-a02e-dcf880d1114f.png)


教育经历
自我评价
第二层（生成评估）：在最终输出答案前，对用户问题的关联性进行评估。全部通过后方可输
出答案，确保每一条回答均有据可循、可信可靠。
基于LangChain+LangGraph的金融智能助手
2025.05 - 2025.08 (3个月)
项目描述： 项目描述：
面向金融/理财业务场景，结合银行级服务流程，覆盖股票行情查询、基金净值分析、理财产品
智能推荐等核心领域。系统通过多Agent协同工作流，由AI大模型辅助完成行情分析、基金推
荐、理财产品匹配及基金申赎建议生成等任务，构建替代传统客服与理财顾问的智能化交互体
系。针对股票买卖、大额基金申赎等敏感交易操作，AI生成建议后通过 interrupt_before 机制触
发人工审批，由客户本人或授权人员最终确认执行，确保金融业务的安全合规。
技术栈： LangChain · LangGraph · PostgresSaver · FastAPI
核心实现与技术突破：
1. 分层工具函数模块
将银行/证券现有业务能力提取并封装为 LangChain 工具，按功能风险划分为 “只读工具”（行情
查询、产品信息浏览）与 “敏感操作工具”（股票交易、基金申赎、理财产品购买）。同时按业
务领域分类（股票、基金、理财、信贷、公共），与大模型动态绑定，使Agent能够根据用户意
图精准触发对应工具调用。
2. 身份认证与权限控制模块
主Agent在启动时通过 fetch_user_info 节点从请求参数中获取客户ID，调用工具查询完整客户
画像（风险等级、账户余额、持仓情况）并持久化至State。执行任意敏感工具节点前均触发
interrupt_before 中断，并利用 PostgreSQL 保存上下文状态。即使流程中断，Agent也可通过
config.thread_id + 客户ID恢复统一上下文，确保交互连续性。
3. 多Agent协同调度模块
将复杂业务流程拆解为四个独立的子工作流，由主Agent居中统一调度，分别对应：股票业务
Agent、基金业务Agent、理财业务Agent、信贷业务Agent。每个子Agent工作流包含五个标准
化节点：入口节点（create_entry_node）、决策节点、只读工具节点、敏感操作工具节点、退
出节点。
• 主工作流 → 子工作流：通过 add_conditional_edges 动态路由实现调度；
• 子工作流 → 主工作流：通过控制State中的 update_dialog_stack 管理工作流栈记录，实现层
级流转。
4. 统一状态管理模块
基于State模块集中管理工作流全局数据，包含：
• messages：完整历史消息列表；
• user_info：当前用户身份、权限及画像信息；
dialog_stack：工作流状态栈，用于追踪当前所处子任务层级及流转路径。
九江学院 \t会计
2021.01 - 2023.01 \t本科 \t统招

![](http://localhost:9000/knowledge-hub/pdf-images/2026/09/22/pdf_img_p5_0-92fbcb37-aaed-4933-ab9f-3692f0d4d5c6.png)


精通 LangChain 与 LangGraph，掌握 LLM、Chains 及 ReAct Agent 核心组件。具备高阶多
Agent 工作流定制能力，熟练运用 DeepAgents 实现任务委派与上下文隔离，设计可插拔中间
件与 HITL 审批机制，保障系统稳定安全。
精通 FunctionTool 与 MCP 协议开发，熟悉 Streamable 异步通信。具备工具合并与 Token 预
算优化能力，支持动态路由。集成 OpenSandbox 安全沙箱，实现文件、进程与网络强隔离及
多层路由配置。
深耕 RAG 技术，使用 UnstructuredLoader 解析多格式文档并支持 OCR。基于 bge-large-zh-
v1.5 部署向量库（Chroma/Milvus），掌握混合检索与 ReRanker 重排序。熟悉 RAG +
RAGAS 评估流程，具备多知识库动态路由检索能力。
掌握大模型私有化部署与记忆管理，熟悉基于 vLLM 部署 DeepSeek、Qwen、Llama 等模型。
熟练运用 MongoDB 构建长期记忆与用户偏好持久化系统，实现 AI 应用工程化落地。

![](http://localhost:9000/knowledge-hub/pdf-images/2026/09/22/pdf_img_p6_0-ffda093c-f8e0-483f-bd65-af56a48fbb68.png)
