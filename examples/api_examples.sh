#!/bin/bash
# ============================================================
# Medical_PBL API 调用示例
# 使用 curl 演示核心 API 接口的调用方式
# ============================================================

# 服务器地址（根据实际部署修改）
BASE_URL="http://localhost:3000"
# 如果部署在远程服务器，修改为实际地址：
# BASE_URL="http://your-server-ip:3000"

# API Token（在 .env 中配置的 API_KEY）
API_KEY="your-api-key-here"

echo "============================================"
echo "  Medical_PBL API 调用示例"
echo "============================================"
echo ""

# -------------------- 1. 健康检查 --------------------
echo "1️⃣  健康检查"
echo "----------------------------------------"
curl -s "${BASE_URL}/health" | python3 -m json.tool 2>/dev/null || curl -s "${BASE_URL}/health"
echo -e "\n"

# -------------------- 2. 获取病例列表 --------------------
echo "2️⃣  获取病例列表（分页）"
echo "----------------------------------------"
curl -s "${BASE_URL}/api/cases?page=1&limit=10" \
  -H "Authorization: Bearer ${API_KEY}" | python3 -m json.tool 2>/dev/null || \
curl -s "${BASE_URL}/api/cases?page=1&limit=10" \
  -H "Authorization: Bearer ${API_KEY}"
echo -e "\n"

# -------------------- 3. 获取单个病例详情 --------------------
echo "3️⃣  获取病例详情（替换 CASE_ID 为实际 ID）"
echo "----------------------------------------"
CASE_ID="example-case-id"
curl -s "${BASE_URL}/api/cases/${CASE_ID}" \
  -H "Authorization: Bearer ${API_KEY}" | python3 -m json.tool 2>/dev/null || \
curl -s "${BASE_URL}/api/cases/${CASE_ID}" \
  -H "Authorization: Bearer ${API_KEY}"
echo -e "\n"

# -------------------- 4. 提交 AI 评分请求 --------------------
echo "4️⃣  提交 AI 评分请求"
echo "----------------------------------------"
curl -s -X POST "${BASE_URL}/api/ai/score" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "case_id": "example-case-id",
    "student_answer": "根据患者的症状和检查结果，初步诊断为..."
  }' | python3 -m json.tool 2>/dev/null || \
curl -s -X POST "${BASE_URL}/api/ai/score" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{"case_id":"example-case-id","student_answer":"根据患者的症状和检查结果，初步诊断为..."}'
echo -e "\n"

# -------------------- 5. 获取评分结果 --------------------
echo "5️⃣  获取评分结果（替换 SCORE_ID 为实际 ID）"
echo "----------------------------------------"
SCORE_ID="example-score-id"
curl -s "${BASE_URL}/api/ai/score/${SCORE_ID}" \
  -H "Authorization: Bearer ${API_KEY}" | python3 -m json.tool 2>/dev/null || \
curl -s "${BASE_URL}/api/ai/score/${SCORE_ID}" \
  -H "Authorization: Bearer ${API_KEY}"
echo -e "\n"

# -------------------- 6. 获取统计数据 --------------------
echo "6️⃣  获取系统统计数据"
echo "----------------------------------------"
curl -s "${BASE_URL}/api/stats" \
  -H "Authorization: Bearer ${API_KEY}" | python3 -m json.tool 2>/dev/null || \
curl -s "${BASE_URL}/api/stats" \
  -H "Authorization: Bearer ${API_KEY}"
echo -e "\n"

echo "============================================"
echo "  示例执行完成"
echo "  请根据实际 API 文档调整参数"
echo "============================================"
