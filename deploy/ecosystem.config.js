// Medical_PBL PM2 进程管理配置
// 使用方式：pm2 start ecosystem.config.js
// 更多配置：https://pm2.keymetrics.io/docs/usage/application-declaration/

module.exports = {
  apps: [
    {
      name: 'medical-pbl',
      script: 'server.js',
      cwd: '/opt/medical-pbl/current',  // 替换为实际项目路径
      
      // 运行模式
      exec_mode: 'fork',  // fork 模式（单实例），如需集群模式改为 'cluster'
      instances: 1,       // 实例数量，'max' 表示使用所有 CPU 核心
      
      // 环境变量
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      
      // 日志配置
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/medical-pbl/error.log',
      out_file: '/var/log/medical-pbl/out.log',
      merge_logs: true,
      
      // 自动重启配置
      max_memory_restart: '500M',  // 内存超过 500MB 自动重启
      max_restarts: 10,            // 最大异常重启次数
      min_uptime: '10s',           // 最小运行时间（低于此时间视为异常）
      restart_delay: 5000,         // 重启延迟（毫秒）
      
      // 监听文件变化自动重启（仅开发环境）
      // watch: true,
      // ignore_watch: ['node_modules', 'uploads', 'logs', 'records'],
      
      // 进程管理
      kill_timeout: 10000,  // 强制 kill 前的等待时间
      listen_timeout: 5000, // 监听超时
      
      // 优雅退出
      shutdown_with_message: true,
      
      // Cron 重启（每天凌晨 4 点重启，释放内存碎片）
      cron_restart: '0 4 * * *',
      
      // 自动启动
      autorestart: true,
      
      // 崩溃后不自动重启的错误码
      stop_exit_codes: [0],
    }
  ]
};
