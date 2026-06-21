/**
 * Segment 验证器
 * 检查段数、类型、长度
 */

/**
 * 验证 segments
 */
function validateSegments(segments, roleKey) {
  const errors = [];
  
  // 1. 基本检查
  if (!Array.isArray(segments) || segments.length === 0) {
    return {
      valid: false,
      errors: ['segments为空或不是数组']
    };
  }
  
  // 2. 段数检查
  const segmentRules = {
    teacher: { min: 2, max: 4 },
    B: { min: 1, max: 3 },
    C: { min: 1, max: 3 }
  };
  
  const rule = segmentRules[roleKey] || segmentRules.teacher;
  if (segments.length < rule.min || segments.length > rule.max) {
    errors.push(`段数${segments.length}不在范围[${rule.min}, ${rule.max}]`);
  }
  
  // 3. 必须类型检查
  const types = segments.map(s => s.type);
  
  if (roleKey === 'teacher') {
    if (!types.some(t => ['question', 'branch'].includes(t))) {
      errors.push('teacher必须包含question或branch段');
    }
    if (!types.some(t => ['tasking', 'priority'].includes(t))) {
      errors.push('teacher必须包含tasking或priority段');
    }
  }
  
  if (roleKey === 'B') {
    if (!types.includes('stance')) {
      errors.push('B必须包含stance段');
    }
  }
  
  if (roleKey === 'C') {
    if (!types.some(t => ['evidence_chain', 'plan', 'operational_next_step'].includes(t))) {
      errors.push('C必须包含evidence_chain/plan/operational_next_step段');
    }
  }
  
  // 4. 段长度检查
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.text || seg.text.length === 0) {
      errors.push(`第${i + 1}段为空`);
    } else if (seg.text.length > 200) {
      errors.push(`第${i + 1}段过长(${seg.text.length}字 > 200字)`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateSegments
};
