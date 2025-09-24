
const express = require('express');

module.exports = ({ db, requireAuth, enqueueDbWrite, clients, sendToClient, notifyAdmin }) => {
    const router = express.Router();
    const chatController = require('../controllers/chatController')({ db, enqueueDbWrite, clients, sendToClient, notifyAdmin });

    router.get('/stats', requireAuth, chatController.getChatStats);
    router.post('/send', requireAuth, chatController.sendMessage);
    router.post('/broadcast', requireAuth, chatController.broadcastMessage);
    router.get('/history/:clientId', requireAuth, chatController.getChatHistoryByClientId);
    router.get('/history', requireAuth, chatController.getChatHistory);
    router.get('/chats', requireAuth, chatController.getChats);
    router.delete('/chats/:chatId', requireAuth, chatController.deleteChat);
    router.post('/chats/:clientId/status', requireAuth, chatController.updateChatStatus);
    router.post('/chats/resolve/:clientId', requireAuth, chatController.resolveChat);
    router.get('/chats/:clientId', requireAuth, chatController.getChatByClientId);
    router.get('/debug', requireAuth, chatController.getDebugInfo);
    router.get('/debug/:clientId', requireAuth, chatController.getDebugInfoByClientId);
    router.post('/reply', requireAuth, chatController.replyToChat);

    return router;
};
