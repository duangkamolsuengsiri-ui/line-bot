// index.js
// Webhook server สำหรับ LINE Messaging API
// Flow: ลูกค้าพิมพ์เลขออเดอร์ 13 หลัก -> ค้นหาในไฟล์ข้อมูล -> ตอบกลับสถานะคืนเงิน

require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const xlsx = require('xlsx');
const path = require('path');

// ------------------------------------------------------------------
// 1) ตั้งค่า LINE SDK ด้วย Channel Secret และ Channel Access Token
// ------------------------------------------------------------------
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);
const app = express();

// ------------------------------------------------------------------
// 2) ที่มาของไฟล์ข้อมูล
//    ตอนนี้ยังใช้ orders-sample.xlsx เป็นตัวอย่างไปก่อน
//    เมื่อทราบที่มาไฟล์จริง (path บน server / Google Sheet / DB) แก้ตรงนี้จุดเดียว
// ------------------------------------------------------------------
const EXCEL_PATH = path.join(__dirname, 'orders-sample.xlsx');

// ------------------------------------------------------------------
// 3) regex ดักเลขออเดอร์ 13 หลักล้วน (ไม่ติดตัวเลขอื่นข้างหน้า/ข้างหลัง)
//    เช่น "เลขออเดอร์ 1234567890123 ค่ะ" -> จับได้ 1234567890123
// ------------------------------------------------------------------
const ORDER_ID_REGEX = /(?<!\d)\d{13}(?!\d)/;

// ------------------------------------------------------------------
// 4) ฟังก์ชันค้นหาออเดอร์ในไฟล์ Excel
//    คาดว่าไฟล์มีคอลัมน์อย่างน้อย: OrderID (13 หลัก), RefundDate
//    โหลดไฟล์ใหม่ทุกครั้งที่ค้นหา เพื่อให้ได้ข้อมูลล่าสุดเสมอ
// ------------------------------------------------------------------
function findOrder(orderId) {
  const workbook = xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { raw: false }); // raw:false ให้ format วันที่เป็น string ตามที่ตั้งในไฟล์

  return rows.find((row) => String(row.OrderID).trim() === orderId);
}

// ------------------------------------------------------------------
// 5) pattern ข้อความตอบกลับ แก้ไขรูปแบบได้ตรงนี้
// ------------------------------------------------------------------
function buildReplyText(orderId, order) {
  if (!order) {
    return `ไม่พบข้อมูลออเดอร์เลขที่ ${orderId} ค่ะ กรุณาตรวจสอบเลขออเดอร์อีกครั้งนะคะ`;
  }

  if (!order.RefundDate) {
    return `เลขที่ออเดอร์ ${orderId} ยังไม่มีข้อมูลการคืนเงินในระบบค่ะ`;
  }

  return `เลขที่ออเดอร์ ${orderId} คืนเงินเรียบร้อยแล้วเมื่อวันที่ ${order.RefundDate} ค่ะ`;
}

// ------------------------------------------------------------------
// 6) Webhook endpoint
// ------------------------------------------------------------------
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userText = event.message.text;
  const match = userText.match(ORDER_ID_REGEX);

  if (!match) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'กรุณาพิมพ์เลขออเดอร์ 13 หลักค่ะ',
    });
  }

  const orderId = match[0];
  const order = findOrder(orderId);
  const replyText = buildReplyText(orderId, order);

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: replyText,
  });
}

app.get('/', (req, res) => res.send('LINE OA refund-status bot is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
