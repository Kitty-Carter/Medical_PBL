// 节点1: ingest_message - 读入最新消息并识别特征
function ingestMessage(graphState) {
  const { room } = graphState;
  const messages = room.messages || [];
  
  if (messages.length === 0) {
    return {
      latestMessage: null,
      senderRole: null,
      contentLength: 0,
      aiPasteSuspected: false,
    };
  }

  const latest = messages[messages.length - 1];
  const content = latest.content || '';
  const contentLength = content.length;
  
  // 识别疑似AI长文（>800字或多段落结构化）
  const aiPasteSuspected = contentLength > 800 || (
    content.includes('1.') && 
    content.includes('2.') && 
    content.includes('3.')
  );

  return {
    latestMessage: latest,
    senderRole: latest.sender?.role || 'student',
    contentLength,
    aiPasteSuspected,
  };
}

module.exports = { ingestMessage };
