const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrCodeGenerate = require('qrcode');
const qrcode = require('qrcode');

const app = express();
const port = 3000;

const client = new Client({
    authStrategy: new LocalAuth()
});

let qrCodeData = "";

client.on('qr', async (qr) => {

    qrCodeData = await qrcode.toDataURL(qr);
    console.log("QR Code Updated!");
});

client.on('ready', () => {
    console.log('WhatsApp Client is Ready!');
});

client.initialize();

app.get('/get_qr_code', (req, res) => {
    res.json({ qr_data: qrCodeData });
});

app.get("/get-chats", async (req, res) => {

    const chats = await client.getChats();
    console.log(chats);
    
    res.json({
        "chats": chats
    });
});

app.listen(port, () => {
    console.log(`WhatsApp QR Code Server on http://localhost:${port}`);
});
