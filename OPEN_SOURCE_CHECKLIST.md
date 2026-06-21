# 开源发布检查清单

## 发布前检查

- [x] 移除所有敏感信息（API Key、密码、Token）
- [x] 移除 node_modules 目录
- [x] 移除 .env 文件（保留 .env.example）
- [x] 移除课堂记录数据（records/）
- [x] 移除上传文件（uploads/）
- [x] 移除日志文件（logs/）
- [x] 移除备份文件
- [x] 添加 LICENSE 文件
- [x] 添加 README.md
- [x] 添加 .gitignore
- [x] 添加部署文档
- [x] 添加使用文档

## 发布后

- [ ] 创建 GitHub Release
- [ ] 上传 tar.gz 压缩包
- [ ] 更新版本号
