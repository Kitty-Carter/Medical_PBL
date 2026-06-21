# Medical PBL - 医学问题导向学习平台

基于 AI 的医学 PBL（Problem-Based Learning）教学平台，支持多角色 AI 评审、实时协作讨论、自动化评分与报告生成。

## 技术栈

- **后端**: Node.js + Express + Socket.IO
- **AI**: LangChain + OpenAI API / DeepSeek API
- **前端**: 原生 HTML/CSS/JS + EJS 模板
- **数据存储**: 文件系统（JSON/Markdown）

## 快速开始

### 环境要求

- Node.js >= 18.x
- npm >= 9.x

### 安装

```bash
git clone https://github.com/Kitty-Carter/Medical_PBL.git
cd Medical_PBL
npm install
cp .env.example .env
# 编辑 .env 填写必要配置
npm start
```

### 使用 Docker

```bash
docker build -t medical-pbl .
docker run -d -p 3000:3000 --env-file .env medical-pbl
```

## 项目结构

```
├── server.js              # 主服务入口
├── package.json           # 项目依赖
├── public/                # 前端静态资源
├── modules/               # 核心业务模块
├── ai_roles/              # AI 角色定义
├── templates/             # EJS 模板
├── databases/             # 数据库文件
├── scripts/               # 工具脚本
├── docs/                  # 文档
├── deploy/                # 部署配置
└── examples/              # 使用示例
```

## 文档

- [快速部署指南](docs/01_快速部署.md)
- [服务器部署说明](docs/02_服务器部署说明.md)
- [AI 配置说明](docs/03_AI配置说明.md)
- [教师使用说明](docs/04_教师使用说明.md)
- [学生使用说明](docs/05_学生使用说明.md)
- [常见问题](docs/06_常见问题.md)
- [隐私与数据安全](docs/07_隐私与数据安全.md)
- [二次开发说明](docs/08_二次开发说明.md)

## 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。
