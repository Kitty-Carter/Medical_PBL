#!/bin/bash
# ============================================================
# Medical_PBL 一键部署脚本
# 适用系统：Ubuntu 20.04+ / Debian 11+
# 用法：chmod +x deploy.sh && sudo ./deploy.sh
# ============================================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目配置
PROJECT_NAME="Medical_PBL"
PROJECT_DIR="/opt/medical-pbl"
RELEASE_DIR="${PROJECT_DIR}/releases/$(date +%Y%m%d%H%M%S)"
CURRENT_DIR="${PROJECT_DIR}/current"
NODE_VERSION="18"
PM2_APP_NAME="medical-pbl"

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否为 root 用户
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "请使用 root 用户或 sudo 运行此脚本"
        exit 1
    fi
}

# 检查系统版本
check_system() {
    log_info "检查系统环境..."
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VER=$VERSION_ID
        log_info "检测到系统：$OS $VER"
    else
        log_error "无法检测系统版本"
        exit 1
    fi
}

# 安装 Node.js
install_nodejs() {
    if command -v node &> /dev/null; then
        CURRENT_NODE=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$CURRENT_NODE" -ge "$NODE_VERSION" ]; then
            log_success "Node.js 已安装：$(node -v)"
            return
        fi
    fi
    
    log_info "安装 Node.js ${NODE_VERSION}.x..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
    log_success "Node.js 安装完成：$(node -v)"
}

# 安装 PM2
install_pm2() {
    if command -v pm2 &> /dev/null; then
        log_success "PM2 已安装：$(pm2 -v)"
        return
    fi
    
    log_info "安装 PM2 进程管理器..."
    npm install -g pm2
    log_success "PM2 安装完成"
}

# 安装 MySQL（可选）
install_mysql() {
    if command -v mysql &> /dev/null; then
        log_success "MySQL 已安装"
        return
    fi
    
    log_warn "未检测到 MySQL，是否需要安装？(y/n)"
    read -r INSTALL_MYSQL
    if [ "$INSTALL_MYSQL" = "y" ] || [ "$INSTALL_MYSQL" = "Y" ]; then
        log_info "安装 MySQL Server..."
        apt-get install -y mysql-server
        log_success "MySQL 安装完成"
        log_info "请运行 'sudo mysql_secure_installation' 进行安全配置"
    else
        log_warn "跳过 MySQL 安装，请确保已有可用的数据库服务"
    fi
}

# 安装 Nginx（可选）
install_nginx() {
    if command -v nginx &> /dev/null; then
        log_success "Nginx 已安装"
        return
    fi
    
    log_warn "未检测到 Nginx，是否需要安装？(y/n)"
    read -r INSTALL_NGINX
    if [ "$INSTALL_NGINX" = "y" ] || [ "$INSTALL_NGINX" = "Y" ]; then
        log_info "安装 Nginx..."
        apt-get install -y nginx
        log_success "Nginx 安装完成"
    else
        log_warn "跳过 Nginx 安装"
    fi
}

# 创建项目目录
setup_directories() {
    log_info "创建项目目录结构..."
    mkdir -p "${PROJECT_DIR}/releases"
    mkdir -p "${PROJECT_DIR}/data/uploads"
    mkdir -p "${PROJECT_DIR}/data/logs"
    mkdir -p "${PROJECT_DIR}/data/records"
    log_success "目录结构创建完成"
}

# 部署项目代码
deploy_code() {
    log_info "部署项目代码到 ${RELEASE_DIR}..."
    
    # 获取脚本所在目录（即 deploy 目录的父目录，也就是项目根目录）
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
    
    # 复制项目文件
    mkdir -p "$RELEASE_DIR"
    rsync -av --exclude='node_modules' \
              --exclude='.env' \
              --exclude='records/' \
              --exclude='uploads/' \
              --exclude='logs/' \
              --exclude='*.log' \
              --exclude='*.tar.gz' \
              --exclude='deploy/' \
              "$PROJECT_ROOT/" "$RELEASE_DIR/"
    
    log_success "项目代码部署完成"
}

# 安装依赖
install_dependencies() {
    log_info "安装项目依赖..."
    cd "$RELEASE_DIR"
    npm install --production
    log_success "依赖安装完成"
}

# 配置环境变量
configure_env() {
    log_info "配置环境变量..."
    if [ ! -f "${RELEASE_DIR}/.env" ]; then
        if [ -f "${RELEASE_DIR}/.env.example" ]; then
            cp "${RELEASE_DIR}/.env.example" "${RELEASE_DIR}/.env"
            log_warn "已从 .env.example 创建 .env 文件，请编辑配置："
            log_warn "  vim ${RELEASE_DIR}/.env"
            log_warn "配置完成后按回车继续..."
            read -r
        else
            log_error ".env.example 文件不存在"
            exit 1
        fi
    else
        log_success ".env 文件已存在"
    fi
}

# 创建软链接
create_symlink() {
    log_info "创建当前版本软链接..."
    if [ -L "$CURRENT_DIR" ]; then
        rm -f "$CURRENT_DIR"
    fi
    ln -s "$RELEASE_DIR" "$CURRENT_DIR"
    log_success "软链接创建完成：${CURRENT_DIR} -> ${RELEASE_DIR}"
}

# 配置 Nginx
configure_nginx() {
    if ! command -v nginx &> /dev/null; then
        log_warn "Nginx 未安装，跳过配置"
        return
    fi
    
    log_info "配置 Nginx 反向代理..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    NGINX_CONF="${SCRIPT_DIR}/nginx.conf"
    
    if [ -f "$NGINX_CONF" ]; then
        cp "$NGINX_CONF" /etc/nginx/sites-available/medical-pbl
        ln -sf /etc/nginx/sites-available/medical-pbl /etc/nginx/sites-enabled/
        
        # 测试配置
        if nginx -t; then
            systemctl reload nginx
            log_success "Nginx 配置完成并已重载"
        else
            log_error "Nginx 配置测试失败，请检查配置文件"
        fi
    else
        log_warn "未找到 nginx.conf 模板，跳过 Nginx 配置"
    fi
}

# 启动服务
start_service() {
    log_info "启动 ${PROJECT_NAME} 服务..."
    
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    ECOSYSTEM_CONF="${SCRIPT_DIR}/ecosystem.config.js"
    
    cd "$CURRENT_DIR"
    
    # 停止旧服务
    pm2 delete "$PM2_APP_NAME" 2>/dev/null || true
    
    # 使用 ecosystem 配置启动
    if [ -f "$ECOSYSTEM_CONF" ]; then
        pm2 start "$ECOSYSTEM_CONF"
    else
        pm2 start server.js --name "$PM2_APP_NAME" --max-memory-restart 512M
    fi
    
    # 保存 PM2 进程列表
    pm2 save
    
    # 设置开机自启
    pm2 startup systemd -u root --hp /root 2>/dev/null || true
    
    log_success "服务启动完成"
}

# 显示部署信息
show_info() {
    echo ""
    echo "============================================"
    echo -e "${GREEN}  🎉 ${PROJECT_NAME} 部署完成！${NC}"
    echo "============================================"
    echo ""
    echo -e "${BLUE}📋 部署信息：${NC}"
    echo "  项目目录：${CURRENT_DIR}"
    echo "  版本目录：${RELEASE_DIR}"
    echo "  服务名称：${PM2_APP_NAME}"
    echo ""
    echo -e "${BLUE}🔧 常用命令：${NC}"
    echo "  查看状态：pm2 status"
    echo "  查看日志：pm2 logs ${PM2_APP_NAME}"
    echo "  重启服务：pm2 restart ${PM2_APP_NAME}"
    echo "  停止服务：pm2 stop ${PM2_APP_NAME}"
    echo ""
    echo -e "${YELLOW}⚠️  重要提醒：${NC}"
    echo "  1. 请编辑 .env 文件配置数据库和 AI 密钥"
    echo "  2. 请配置防火墙开放服务端口"
    echo "  3. 请配置 Nginx 中的域名和 SSL 证书"
    echo ""
    echo -e "${BLUE}📖 详细文档：${NC}"
    echo "  ${CURRENT_DIR}/docs/"
    echo ""
}

# 主流程
main() {
    echo ""
    echo "============================================"
    echo -e "${BLUE}  Medical_PBL 一键部署脚本${NC}"
    echo "============================================"
    echo ""
    
    check_root
    check_system
    
    # 更新系统包
    log_info "更新系统包列表..."
    apt-get update -qq
    
    # 安装基础依赖
    log_info "安装基础依赖..."
    apt-get install -y -qq curl git rsync
    
    install_nodejs
    install_pm2
    install_mysql
    install_nginx
    setup_directories
    deploy_code
    install_dependencies
    configure_env
    create_symlink
    configure_nginx
    start_service
    show_info
}

# 执行主流程
main "$@"
