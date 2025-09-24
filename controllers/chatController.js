
module.exports = ({ db, enqueueDbWrite, clients, sendToClient, notifyAdmin }) => {
    const chatService = require('../services/chatService')({ db, enqueueDbWrite, clients, sendToClient, notifyAdmin });

    const getChatStats = (req, res) => {
        const stats = chatService.getChatStats();
        res.json(stats);
    };

    const sendMessage = async (req, res) => {
        const { clientId, message } = req.body;
        
        if (!clientId || !message) {
            return res.status(400).json({ success: false, error: 'Client ID and message are required' });
        }

        try {
            const result = await chatService.sendMessage(clientId, message, true); // true for isAdmin
            res.json(result);
        } catch (e) {
            console.error('Error sending message via REST:', e);
            return res.status(500).json({ success: false, error: 'Failed to send message' });
        }
    };

    const broadcastMessage = (req, res) => {
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, error: 'Message is required' });
        }
        
        const count = chatService.broadcastToClients(message);
        res.json({ success: true, message: `Message broadcast to ${count} clients` });
    };

    const getChatHistoryByClientId = async (req, res) => {
        const { clientId } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        try {
            const history = await chatService.getChatHistoryByClientId(clientId, limit);
            return res.json(history);
        } catch (e) {
            console.error('Error reading chat history from DB:', e);
            return res.status(500).json({ error: 'Database error' });
        }
    };

    const getChatHistory = (req, res) => {
        const limit = parseInt(req.query.limit) || 100;
        const history = chatService.getChatHistory(limit);
        res.json(history);
    };

    const getChats = async (req, res) => {
      try {
        const chats = await chatService.getChats();
        res.json(chats);
      } catch (err) {
        res.status(500).json({ error: 'Database error' });
      }
    };

    const deleteChat = async (req, res) => {
      const chatId = req.params.chatId;
      
      try {
        const result = await chatService.deleteChat(chatId);
        if (result) {
            res.json({ success: true, message: 'Chat deleted successfully' });
        } else {
            res.status(404).json({ error: 'Chat not found' });
        }
      } catch (err) {
        res.status(500).json({ error: 'Database error' });
      }
    };

    const updateChatStatus = async (req, res) => {
        const { clientId } = req.params;
        const { status } = req.body;

        if (!['active', 'resolved'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        try {
            const result = await chatService.updateChatStatus(clientId, status);
            if (result) {
                res.json({ success: true, message: `Chat status updated to ${status}` });
            } else {
                res.status(404).json({ error: 'Chat not found or cannot modify admin chat' });
            }
        } catch (err) {
            res.status(500).json({ error: 'Database error' });
        }
    };

    const resolveChat = async (req, res) => {
        const clientId = req.params.clientId;

        try {
            const result = await chatService.updateChatStatus(clientId, 'resolved');
            if (result) {
                res.json({ success: true, message: 'Chat resolved successfully' });
            } else {
                res.status(404).json({ error: 'Chat not found or cannot resolve admin chat' });
            }
        } catch (err) {
            console.error('Database error:', err);
            res.status(500).json({ error: 'Database error' });
        }
    };

    const getChatByClientId = async (req, res) => {
      const clientId = req.params.clientId;
      
      try {
        const chat = await chatService.getChatByClientId(clientId);
        if (chat) {
          res.json(chat);
        } else {
          res.status(404).json({ error: 'Chat not found' });
        }
      } catch (err) {
        res.status(500).json({ error: 'Database error' });
      }
    };

    const getDebugInfo = (req, res) => {
        const debugInfo = chatService.getDebugInfo();
        res.json(debugInfo);
    };

    const getDebugInfoByClientId = (req, res) => {
        const clientId = req.params.clientId;
        const debugInfo = chatService.getDebugInfoByClientId(clientId);
        
        if (!debugInfo) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        res.json(debugInfo);
    };

    const replyToChat = async (req, res) => {
        const { clientId, message } = req.body;
        
        if (!clientId || !message) {
            return res.status(400).json({ 
                success: false, 
                error: 'Client ID and message are required' 
            });
        }

        try {
            const result = await chatService.sendMessage(clientId, message, true); // true for isAdmin
            res.json(result);
        } catch (error) {
            console.error('Error replying to chat:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to send reply' 
            });
        }
    };

    const deleteChatById = async (req, res) => {
        const chatId = req.params.id;
        
        if (!chatId) {
            return res.status(400).json({ error: 'Chat ID is required' });
        }
        
        try {
            const result = await chatService.deleteChat(chatId);
            if (result) {
                res.json({ success: true, message: 'Chat deleted successfully' });
            } else {
                res.status(404).json({ error: 'Chat not found' });
            }
        } catch (error) {
            console.error('Error deleting chat:', error);
            res.status(500).json({ error: 'Database error' });
        }
    };

    return { 
        getChatStats, sendMessage, broadcastMessage, getChatHistoryByClientId, 
        getChatHistory, getChats, deleteChat, updateChatStatus, resolveChat, 
        getChatByClientId, getDebugInfo, getDebugInfoByClientId, replyToChat, deleteChatById 
    };
};
