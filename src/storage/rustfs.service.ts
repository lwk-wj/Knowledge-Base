import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { extname } from 'path';

/**
 * 上传字节数据配置选项
 */
export interface UploadBytesOptions {
  /** 原始文件名（用于推断后缀及格式化文件名） */
  fileName: string;
  /** 文件 MIME 类型（如 image/png、application/pdf） */
  contentType: string;
  /** 对象 key 存储路径前缀，默认 documents */
  prefix?: string;
}

/**
 * RustFS 文件存储服务（基于 S3 兼容协议）
 * 负责与兼容 S3 协议的对象存储服务通信，处理文件上传、Bucket 初始化以及路径拼接。
 */
@Injectable()
export class RustfsService implements OnModuleInit {
  private readonly logger = new Logger(RustfsService.name);
  /** S3 客户端实例 */
  private client: S3Client | null = null;
  /** 存储服务开启状态 */
  private enabled = false;
  /** 目标 Bucket 存储桶名称 */
  private bucket = '';
  /** 文件访问公网域名基础路径 */
  private publicBaseUrl = '';

  constructor(private readonly config: ConfigService) {}

  /**
   * 模块初始化生命周期钩子：读取环境配置，初始化 S3 客户端，并建立 Bucket 存储桶
   */
  onModuleInit() {
    // 读取开关配置，默认启用
    this.enabled =
      this.config.get<string>('RUSTFS_ENABLED', 'true').toLowerCase() !==
      'false';

    if (!this.enabled) {
      this.logger.warn('RustFS 已禁用（RUSTFS_ENABLED=false），文件上传将跳过');
      return;
    }

    // 从环境变量中获取 S3 存储连接参数
    const endpoint = this.config.get<string>(
      'RUSTFS_ENDPOINT',
      'http://localhost:9000',
    );
    const accessKey = this.config.get<string>('RUSTFS_ACCESS_KEY', 'rustfsadmin');
    const secretKey = this.config.get<string>(
      'RUSTFS_SECRET_KEY',
      'rustfsadmin',
    );
    const region = this.config.get<string>('RUSTFS_REGION', 'us-east-1');
    this.bucket = this.config.get<string>('RUSTFS_BUCKET', 'knowledge-hub');
    this.publicBaseUrl = (
      this.config.get<string>('RUSTFS_PUBLIC_URL') || endpoint
    ).replace(/\/$/, '');

    // 实例化 AWS S3 客户端，forcePathStyle 开启路径访问模式（适用于 MinIO/RustFS 等自建服务）
    this.client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });

    this.logger.log(
      `RustFS 已配置: endpoint=${endpoint}, bucket=${this.bucket}, public=${this.publicBaseUrl}`,
    );

    // 尝试创建/检查存储桶，若首次连接失败捕获警告并在稍后上传时自动重试
    void this.ensureBucket().catch((err) => {
      this.logger.warn(
        `RustFS 初始化 bucket 失败（首次上传时会重试）: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  /**
   * 检查 RustFS 存储服务是否已启用且客户端可用
   */
  isEnabled(): boolean {
    return this.enabled && this.client != null;
  }

  /**
   * 上传二进制字节数据至 RustFS
   * 
   * @param bytes 文件 Buffer 或 Uint8Array 数据
   * @param options 上传配置选项（文件名、ContentType、前缀目录）
   * @returns 拼接后的完整公网可访问 HTTP URL 字符串（{publicBase}/{bucket}/{key}）
   */
  async uploadBytes(
    bytes: Buffer | Uint8Array,
    options: UploadBytesOptions,
  ): Promise<string> {
    if (!this.isEnabled() || !this.client) {
      throw new ServiceUnavailableException(
        'RustFS 未启用或未配置，无法上传文件',
      );
    }

    // 确保 Bucket 存在
    await this.ensureBucket();

    // 格式化前缀，并生成：prefix/YYYY/MM/DD/safeFileName-UUID.ext 结构的唯一 Key
    const prefix = (options.prefix ?? 'documents').replace(/^\/+|\/+$/g, '');
    const ext = extname(options.fileName) || guessExt(options.contentType);
    const safeBase = sanitizeBaseName(options.fileName);
    const key = `${prefix}/${formatDatePath()}/${safeBase}-${randomUUID()}${ext}`;
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

    // 调用 S3 API 执行 PutObject 上传指令
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ContentLength: body.length,
      }),
    );

    // 生成并记录公网访问 URL
    const url = `${this.publicBaseUrl}/${this.bucket}/${key}`;
    this.logger.log(
      `RustFS 上传成功: key=${key}, size=${body.length}, url=${url}`,
    );
    return url;
  }

  /**
   * 确保存储桶 Bucket 存在，若不存在则调用 API 自动创建
   */
  private async ensureBucket(): Promise<void> {
    if (!this.client) return;

    // 1. 尝试使用 HeadBucket 探针检测存储桶是否存在
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      // Bucket 不存在，触发下方创建流程
    }

    // 2. 发送指令创建存储桶
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`RustFS bucket 已创建: ${this.bucket}`);
    } catch (err) {
      // 容错处理：并发部署或创建时若存储桶已建立，则忽略该重复创建异常
      const message = err instanceof Error ? err.message : String(err);
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists|already exists/i.test(message)) {
        throw err;
      }
    }
  }
}

/**
 * 生成按当前日期归档的路径字符串（格式：YYYY/MM/DD）
 */
function formatDatePath(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

/**
 * 格式化清洗文件名，去掉非安全字符并限制长度，防止 URL 编码或 Key 解析异常
 */
function sanitizeBaseName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '') || 'file';
  return base
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
    .slice(0, 64);
}

/**
 * 根据文件 MIME 类型推断后缀扩展名
 */
function guessExt(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'application/pdf':
      return '.pdf';
    default:
      return '';
  }
}

