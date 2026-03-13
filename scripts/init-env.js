import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 获取当前文件路径 (ESM 模式)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, '..');
const examplePath = path.join(rootDir, '.env.example');
const envPath = path.join(rootDir, '.env');

// 生成随机安全密钥
const generateSecret = () => crypto.randomBytes(32).toString('hex');

console.log('🔄 正在检查环境配置...');

if (fs.existsSync(envPath)) {
  console.log('✅ .env 文件已存在，跳过初始化。');
  process.exit(0);
}

if (!fs.existsSync(examplePath)) {
  console.error('❌ 未找到 .env.example 模板文件！');
  process.exit(1);
}

try {
  let content = fs.readFileSync(examplePath, 'utf-8');

  // === 自动填充一些安全值，省去手动生成的麻烦 ===
  
  // 1. 生成 JWT Secret
  const jwtSecret = generateSecret();
  content = content.replace('your-super-secret-jwt-key-here', jwtSecret);

  // 2. 设置本地开发默认的 DB 密码 (这里设为 "password" 方便本地开发，生产环境请务必修改)
  // 同时替换 DATABASE_URL 和 POSTGRES_PASSWORD 以保持一致
  const devDbPassword = 'password';
  content = content.replace(/your_secure_password_here/g, devDbPassword);

  // 3. AI 配置提示
  console.log('');
  console.log('🤖 AI 服务配置说明：');
  console.log('   - 当前默认：Qwen（dashscope）主力，DeepSeek 备选');
  console.log('   - 请至少配置 DASHSCOPE_API_KEY；如需降级兜底，再配置 DEEPSEEK_API_KEY');
  console.log('   - 当前运行口径：qwen + deepseek');
  console.log('');

  // 写入 .env
  fs.writeFileSync(envPath, content);

  console.log('🎉 .env 文件创建成功！');
  console.log('🔒 已自动生成随机 JWT_SECRET');
  console.log(`🔑 数据库密码默认设置为: "${devDbPassword}" (请确保与 docker-compose 一致)`);
  console.log('🤖 请配置 AI 服务的 API Key 以启用 AI 功能');
  console.log('📝 请检查 .env 文件并根据需要调整其他配置。');

} catch (error) {
  console.error('❌ 创建 .env 文件失败:', error);
  process.exit(1);
}