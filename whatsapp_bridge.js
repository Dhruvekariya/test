
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const app = express();

// Configure Express
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Settings
const ODOO_URL = process.env.ODOO_URL || 'http://localhost:8069';
const ODOO_DB = process.env.ODOO_DB || 'odoo';
const ODOO_USERNAME = process.env.ODOO_USERNAME || 'admin';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD || 'admin';
const PORT = process.env.PORT || 3000;

// Store active WhatsApp clients
const clients = {};

// Authenticate with Odoo
async function authenticateOdoo() {
    try {
        const response = await axios.post(`${ODOO_URL}/web/session/authenticate`, {
            jsonrpc: '2.0',
            params: {
                db: ODOO_DB,
                login: ODOO_USERNAME,
                password: ODOO_PASSWORD
            }
        });
        
        if (response.data && response.data.result) {
            return response.data.result.session_id;
        }
        
        throw new Error('Authentication failed');
    } catch (error) {
        console.error('Odoo authentication error:', error);
        throw error;
    }
}

// Send event to Odoo webhook
async function sendToOdoo(event) {
    try {
        const sessionId = await authenticateOdoo();
        
        const response = await axios.post(`${ODOO_URL}/whatsapp/hook`, event, {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `session_id=${sessionId}`
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('Error sending to Odoo:', error);
        throw error;
    }
}

// Initialize WhatsApp client
function initWhatsAppClient(sessionId) {
    if (clients[sessionId]) {
        return clients[sessionId];
    }
    
    // Create client instance
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: sessionId,
            dataPath: path.join(__dirname, 'sessions')
        }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });
    
    // Register event handlers
    client.on('qr', async (qr) => {
        // Generate QR code image
        try {

            console.log("qr-==--==-",qr);
            
            const qrImage = await qrcode.toDataURL(qr);
            
            // Store QR code for the session
            clients[sessionId].qrCode = qrImage.replace(/^data:image\/png;base64,/, '');
            
            // Update session status
            await sendToOdoo({
                type: 'connection_update',
                session_id: sessionId,
                status: 'connecting',
                qr_code: clients[sessionId].qrCode
            });
        } catch (error) {
            console.error('QR code generation error:', error);
        }
    });
    
    client.on('ready', async () => {
        // WhatsApp is ready
        clients[sessionId].state = 'connected';
        clients[sessionId].connectedAt = Date.now() / 1000;
        
        // Update session status
        await sendToOdoo({
            type: 'connection_update',
            session_id: sessionId,
            status: 'connected',
            connected_at: clients[sessionId].connectedAt
        });
        
        console.log(`WhatsApp client ready for session ${sessionId}`);
    });
    
    client.on('message', async (message) => {
        // Handle incoming message
        try {
            const chat = await message.getChat();
            let contactName = 'Unknown';
            
            if (chat.isGroup) {
                contactName = chat.name;
            } else {
                const contact = await message.getContact();
                contactName = contact.name || contact.pushname || contact.number;
            }
            
            // Send message to Odoo
            await sendToOdoo({
                type: 'message',
                session_id: sessionId,
                message: {
                    id: message.id.id,
                    chat_id: message.from,
                    contact_name: contactName,
                    content: message.body,
                    timestamp: message.timestamp
                }
            });
        } catch (error) {
            console.error('Error handling incoming message:', error);
        }
    });
    
    client.on('message_ack', async (message, ack) => {
        // Message acknowledgment status
        // 0: pending, 1: received, 2: sent, 3: delivered, 4: read
        let status;
        
        switch (ack) {
            case 1: status = 'pending'; break;
            case 2: status = 'sent'; break;
            case 3: status = 'delivered'; break;
            case 4: status = 'read'; break;
            default: status = 'pending';
        }
        
        // Send status update to Odoo
        await sendToOdoo({
            type: 'status_update',
            session_id: sessionId,
            status: {
                message_id: message.id.id,
                status: status
            }
        });
    });
    
    client.on('disconnected', async () => {
        // WhatsApp disconnected
        clients[sessionId].state = 'disconnected';
        
        // Update session status
        await sendToOdoo({
            type: 'connection_update',
            session_id: sessionId,
            status: 'disconnected'
        });
        
        console.log(`WhatsApp client disconnected for session ${sessionId}`);
        
        // Clean up and delete the client
        delete clients[sessionId];
    });
    
    // Initialize client data
    clients[sessionId] = {
        client: client,
        state: 'disconnected',
        qrCode: null,
        connectedAt: null
    };
    
    // Initialize the client
    client.initialize();
    
    return clients[sessionId];
}

// API endpoints
app.post('/start', async (req, res) => {
    const { session_id } = req.body;
    
    if (!session_id) {
        return res.status(400).json({ error: 'Missing session ID' });
    }
    
    try {
        initWhatsAppClient(session_id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error starting WhatsApp client:', error);
        res.status(500).json({ error: 'Failed to start WhatsApp client' });
    }
});

app.get('/qr_code/:session_id', async (req, res) => {
    const { session_id } = req.params;
    
    if (!clients[session_id]) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    if (clients[session_id].qrCode) {
        // Send QR code image
        const img = Buffer.from(clients[session_id].qrCode, 'base64');
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': img.length
        });
        res.end(img);
    } else {
        res.status(404).json({ error: 'QR code not available' });
    }
});

app.get('/status/:session_id', async (req, res) => {
    const { session_id } = req.params;
    
    if (!clients[session_id]) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({
        state: clients[session_id].state,
        connected_at: clients[session_id].connectedAt
    });
});

app.post('/send', async (req, res) => {
    const { session_id, chat_id, message } = req.body;
    
    if (!session_id || !chat_id || !message) {
        return res.status(400).json({ error: 'Missing parameters' });
    }
    
    if (!clients[session_id] || clients[session_id].state !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    
    try {
        // Send message
        const sentMessage = await clients[session_id].client.sendMessage(chat_id, message);
        
        res.json({
            success: true,
            message_id: sentMessage.id.id
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

app.get('/chats/:session_id', async (req, res) => {
    const { session_id } = req.params;
    
    if (!clients[session_id] || clients[session_id].state !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    
    try {
        // Get all chats
        const chats = await clients[session_id].client.getChats();
        
        // Format and send chats
        const formattedChats = await Promise.all(chats.map(async (chat) => {
            let name;
            
            if (chat.isGroup) {
                name = chat.name;
            } else {
                const contact = await chat.getContact();
                name = contact.name || contact.pushname || contact.number;
            }
            
            return {
                id: chat.id._serialized,
                name: name,
                unread: chat.unreadCount,
                timestamp: chat.timestamp,
                last_message: chat.lastMessage ? chat.lastMessage.body : ''
            };
        }));
        
        res.json(formattedChats);
    } catch (error) {
        console.error('Error getting chats:', error);
        res.status(500).json({ error: 'Failed to get chats' });
    }
});

app.get('/messages/:session_id/:chat_id', async (req, res) => {
    const { session_id, chat_id } = req.params;
    const { limit, before } = req.query;
    
    if (!clients[session_id] || clients[session_id].state !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    
    try {
        // Get chat
        const chat = await clients[session_id].client.getChatById(chat_id);
        
        // Get messages
        const messages = await chat.fetchMessages({
            limit: parseInt(limit) || 50,
            fromMe: undefined
        });
        
        // Format and send messages
        const formattedMessages = messages.map((message) => ({
            id: message.id.id,
            chat_id: message.from,
            content: message.body,
            timestamp: message.timestamp,
            direction: message.fromMe ? 'outgoing' : 'incoming',
            state: message._data.ack === 3 ? 'delivered' : 
                   message._data.ack === 4 ? 'read' : 'sent'
        }));
        
        res.json(formattedMessages);
    } catch (error) {
        console.error('Error getting messages:', error);
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

app.post('/read/:session_id', async (req, res) => {
    const { session_id } = req.params;
    const { chat_id } = req.body;
    
    if (!chat_id) {
        return res.status(400).json({ error: 'Missing chat ID' });
    }
    
    if (!clients[session_id] || clients[session_id].state !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    
    try {
        // Get chat
        const chat = await clients[session_id].client.getChatById(chat_id);
        
        // Mark chat as read
        await chat.sendSeen();
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking chat as read:', error);
        res.status(500).json({ error: 'Failed to mark chat as read' });
    }
});

app.post('/logout/:session_id', async (req, res) => {
    const { session_id } = req.params;
    
    if (!clients[session_id]) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    try {
        // Logout
        await clients[session_id].client.logout();
        
        // Delete client
        delete clients[session_id];
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error logging out:', error);
        res.status(500).json({ error: 'Failed to logout' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`WhatsApp Bridge Service running on port ${PORT}`);
});





