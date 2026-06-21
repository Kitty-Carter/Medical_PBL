-- ============================================================
-- Medical_PBL 数据库初始化脚本
-- 适用数据库：MySQL 8.0+ / MariaDB 10.5+
-- 用法：mysql -u root -p < init_db.sql
-- ============================================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS medical_pbl
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE medical_pbl;

-- -------------------- 用户表 --------------------
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
    password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
    email VARCHAR(100) DEFAULT NULL COMMENT '邮箱',
    role ENUM('admin', 'teacher', 'student') NOT NULL DEFAULT 'student' COMMENT '角色',
    display_name VARCHAR(100) DEFAULT NULL COMMENT '显示名称',
    avatar_url VARCHAR(500) DEFAULT NULL COMMENT '头像地址',
    is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否激活',
    last_login_at DATETIME DEFAULT NULL COMMENT '最后登录时间',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_username (username),
    INDEX idx_role (role),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- -------------------- 病例表 --------------------
CREATE TABLE IF NOT EXISTS cases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL COMMENT '病例标题',
    description TEXT COMMENT '病例描述',
    category VARCHAR(100) DEFAULT NULL COMMENT '病例分类（内科/外科/妇产科等）',
    difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'medium' COMMENT '难度等级',
    patient_info JSON DEFAULT NULL COMMENT '患者信息（JSON格式）',
    symptoms TEXT COMMENT '症状描述',
    examination_results TEXT COMMENT '检查结果',
    reference_answer TEXT COMMENT '参考答案',
    scoring_criteria JSON DEFAULT NULL COMMENT '评分标准（JSON格式）',
    tags VARCHAR(500) DEFAULT NULL COMMENT '标签（逗号分隔）',
    status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft' COMMENT '状态',
    created_by INT DEFAULT NULL COMMENT '创建者ID',
    view_count INT NOT NULL DEFAULT 0 COMMENT '浏览次数',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_category (category),
    INDEX idx_difficulty (difficulty),
    INDEX idx_status (status),
    INDEX idx_created_by (created_by),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='病例表';

-- -------------------- 评分记录表 --------------------
CREATE TABLE IF NOT EXISTS score_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    case_id INT NOT NULL COMMENT '病例ID',
    student_id INT NOT NULL COMMENT '学生ID',
    student_answer TEXT NOT NULL COMMENT '学生答案',
    ai_score DECIMAL(5,2) DEFAULT NULL COMMENT 'AI评分',
    ai_feedback TEXT COMMENT 'AI反馈',
    ai_model VARCHAR(100) DEFAULT NULL COMMENT '使用的AI模型',
    ai_tokens_used INT DEFAULT 0 COMMENT '消耗的Token数',
    teacher_score DECIMAL(5,2) DEFAULT NULL COMMENT '教师评分',
    teacher_feedback TEXT COMMENT '教师反馈',
    status ENUM('pending', 'scored', 'reviewed') NOT NULL DEFAULT 'pending' COMMENT '评分状态',
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '提交时间',
    scored_at DATETIME DEFAULT NULL COMMENT '评分时间',
    reviewed_at DATETIME DEFAULT NULL COMMENT '审核时间',
    INDEX idx_case_id (case_id),
    INDEX idx_student_id (student_id),
    INDEX idx_status (status),
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评分记录表';

-- -------------------- 系统配置表 --------------------
CREATE TABLE IF NOT EXISTS system_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    config_key VARCHAR(100) NOT NULL UNIQUE COMMENT '配置键',
    config_value TEXT COMMENT '配置值',
    description VARCHAR(500) DEFAULT NULL COMMENT '配置说明',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_config_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';

-- -------------------- 操作日志表 --------------------
CREATE TABLE IF NOT EXISTS operation_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL COMMENT '操作用户ID',
    action VARCHAR(100) NOT NULL COMMENT '操作类型',
    target_type VARCHAR(50) DEFAULT NULL COMMENT '操作对象类型',
    target_id INT DEFAULT NULL COMMENT '操作对象ID',
    details JSON DEFAULT NULL COMMENT '操作详情（JSON格式）',
    ip_address VARCHAR(45) DEFAULT NULL COMMENT 'IP地址',
    user_agent VARCHAR(500) DEFAULT NULL COMMENT '用户代理',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
    INDEX idx_user_id (user_id),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作日志表';

-- -------------------- 插入示例数据 --------------------

-- 示例管理员用户（密码：admin123，实际使用请修改）
INSERT INTO users (username, password_hash, email, role, display_name) VALUES
('admin', '$2b$10$example_hash_please_replace_with_real_hash', 'admin@medical-pbl.com', 'admin', '系统管理员'),
('teacher_demo', '$2b$10$example_hash_please_replace_with_real_hash', 'teacher@medical-pbl.com', 'teacher', '张教授'),
('student_demo', '$2b$10$example_hash_please_replace_with_real_hash', 'student@medical-pbl.com', 'student', '李同学');

-- 示例病例
INSERT INTO cases (title, description, category, difficulty, symptoms, reference_answer, status, created_by) VALUES
('急性阑尾炎病例分析', '患者男性，25岁，因转移性右下腹痛6小时就诊...', '普外科', 'medium',
 '右下腹持续性疼痛，伴恶心呕吐，体温38.2℃，白细胞计数升高',
 '根据典型症状和体征，结合血常规和腹部B超检查，诊断为急性阑尾炎，建议急诊手术治疗',
 'published', 2),
('高血压病诊疗方案', '患者女性，58岁，反复头晕头痛2年，加重1周...', '心内科', 'easy',
 '血压160/95mmHg，头晕，心悸，无其他明显不适',
 '诊断为原发性高血压2级，建议低盐饮食、规律运动，口服降压药物治疗，定期监测血压',
 'published', 2),
('糖尿病酮症酸中毒急救', '患者男性，42岁，1型糖尿病史10年，因恶心呕吐、意识模糊来诊...', '内分泌科', 'hard',
 '血糖28.6mmol/L，尿酮体+++，pH 7.12，意识模糊',
 '诊断为糖尿病酮症酸中毒，立即补液、胰岛素治疗、纠正电解质紊乱，密切监测生命体征',
 'published', 2);

-- 示例系统配置
INSERT INTO system_config (config_key, config_value, description) VALUES
('site_name', 'Medical_PBL', '网站名称'),
('max_upload_size', '10485760', '最大上传文件大小（字节）'),
('session_timeout', '3600', '会话超时时间（秒）'),
('ai_default_model', 'gpt-4', '默认AI模型');

-- 完成
SELECT '✅ Medical_PBL 数据库初始化完成！' AS message;
SELECT COUNT(*) AS user_count FROM users;
SELECT COUNT(*) AS case_count FROM cases;
