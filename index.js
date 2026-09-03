// index.js
// Webhook server สำหรับ LINE Messaging API
// Flow: ลูกค้าพิมพ์เลขออเดอร์ 13 หลัก -> ค้นหาใน Google Sheet -> ตอบกลับสถานะคืนเงิน

require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

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
// 2) ที่มาของข้อมูล: Google Sheet "เอาไว้ตรวจสอบคืนเงิน"
//    ดึงเป็น CSV ผ่าน export URL — ถ้าเปลี่ยนชีตหรือแท็บ แก้ตรงนี้จุดเดียว
// ------------------------------------------------------------------
const SHEET_ID = '1EgYaKG4ngHV2FALefDY3oDgaaixDMK2lVTcwvjUYnbg';
const GID = '0'; // gid ของแท็บ "ชีต1" — ถ้าไม่ตรง ต้องเช็คจาก URL ตอนเปิดแท็บนั้นในเบราว์เซอร์
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

// ------------------------------------------------------------------
// 3) regex ดักเลขออเดอร์ 13 หลักล้วน (ไม่ติดตัวเลขอื่นข้างหน้า/ข้างหลัง)
//    เช่น "เลขออเดอร์ 1234567890123 ค่ะ" -> จับได้ 1234567890123
// ------------------------------------------------------------------
const ORDER_ID_REGEX = /(?<!\d)\d{13}(?!\d)/;

// ------------------------------------------------------------------
// 4) ฟังก์ชันค้นหาออเดอร์ใน Google Sheet
//    คอลัมน์ที่ใช้: LTJ Order Id, Noted (Refund/Not yet), ยอดคืนเงิน, ช่องทาง, RefundDate
//    ดึงข้อมูลใหม่ทุกครั้งที่ค้นหา เพื่อให้ได้ข้อมูลล่าสุดเสมอ
// ------------------------------------------------------------------
async function findOrder(orderId) {
  const res = await axios.get(CSV_URL);
  // ตัด BOM (\uFEFF) ที่ Google Sheets มักแอบใส่หน้าคอลัมน์แรก ไม่งั้น key ของคอลัมน์แรกจะเพี้ยน
  const cleanCsv = res.data.replace(/^\uFEFF/, '');
  const rows = parse(cleanCsv, { columns: true, skip_empty_lines: true, trim: true });

  return rows.find((row) => {
    const idDigits = String(row['LTJ Order Id']).replace(/\D/g, ''); // ตัด "LTJ" ออก เหลือแต่เลข
    return idDigits === orderId;
  });
}

// ------------------------------------------------------------------
// 5) pattern ข้อความตอบกลับ แก้ไขรูปแบบได้ตรงนี้
// ------------------------------------------------------------------
function buildReplyText(orderId, order) {
  if (!order) {
    return `ไม่พบข้อมูลออเดอร์เลขที่ ${orderId} ค่ะ กรุณาตรวจสอบเลขออเดอร์อีกครั้งนะคะ`;
  }

  const noted = (order['Noted'] || '').trim();
  const amount = order['ยอดคืนเงิน'];
  const channel = order['ช่องทาง'];
  const refundDate = (order['RefundDate'] || '').trim();

  if (noted !== 'Refund') {
    return `เลขที่ออเดอร์ ${orderId} อยู่ระหว่างดำเนินการคืนเงินค่ะ`;
  }

  if (!refundDate) {
    return `เลขที่ออเดอร์ ${orderId} คืนเงินเรียบร้อยแล้ว จำนวน ${amount} บาท ผ่านช่องทาง ${channel} ค่ะ (ยังไม่มีข้อมูลวันที่คืนเงินในระบบ)`;
  }

  return `เลขที่ออเดอร์ ${orderId} คืนเงินเรียบร้อยแล้วเมื่อวันที่ ${refundDate} จำนวน ${amount} บาท ผ่านช่องทาง ${channel} ค่ะ`;
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
  const order = await findOrder(orderId);
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
