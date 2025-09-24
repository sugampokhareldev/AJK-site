
const express = require('express');

module.exports = ({ db, requireAuth, enqueueDbWrite, clients, sendToClient, notifyAdmin }) => {
    const router = express.Router();
    const formRoutes = require('./form')({ db, enqueueDbWrite });
    const submissionRoutes = require('./submissions')({ db, requireAuth, enqueueDbWrite });
    const chatRoutes = require('./chat')({ db, requireAuth, enqueueDbWrite, clients, sendToClient, notifyAdmin });

    router.use('/form', formRoutes);
    router.use('/submissions', submissionRoutes);
    router.use('/chat', chatRoutes);

    return router;
};
