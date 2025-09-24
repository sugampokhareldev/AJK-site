
const validator = require('validator');

module.exports = ({ db, enqueueDbWrite, notifyAdmin }) => {
    const formService = require('../services/formService')({ db, enqueueDbWrite });

    const submitForm = async (req, res) => {
        try {
            const submission = await formService.submitForm(req.body, req.ip);
            
            notifyAdmin('new_submission', {
                id: submission.id,
                name: submission.name,
                email: submission.email
            });
            
            console.log('Form submission received:', { id: submission.id, email: submission.email });
            
            res.json({ success: true, id: submission.id });
        } catch (error) {
            console.error('Form submission error:', error);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    };

    return { submitForm };
};
