/**
 * 讨论记录 docx 导出模块
 */
const { Document, Packer, Paragraph, TextRun } = require('docx');

function getDisplayName(msg) {
  if (!msg.sender) return '未知';
  const s = msg.sender;
  if (s.role && s.role.startsWith('ai_')) return s.name || 'AI';
  return `${s.name} (${s.id || s.studentId || '-'})`;
}

async function generateDocx(room, teacherName, date) {
  const textMessages = (room.messages || []).filter((m) => m.type !== 'file');
  const children = [
    new Paragraph({
      children: [new TextRun({ text: `讨论记录 - 教师：${teacherName}  日期：${date}`, bold: true })],
    }),
    new Paragraph({ children: [new TextRun('')] }),
  ];

  textMessages
    .sort((a, b) => (a.time || 0) - (b.time || 0))
    .forEach((msg) => {
      const senderName = getDisplayName(msg);
      const timeStr = new Date(msg.time || Date.now()).toLocaleString('zh-CN');
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${senderName}  ${timeStr}`, bold: true })],
        }),
        new Paragraph({
          children: [new TextRun({ text: msg.content || '(无内容)', break: 1 })],
        }),
        new Paragraph({ children: [new TextRun('')] })
      );
    });

  const doc = new Document({
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = generateDocx;
