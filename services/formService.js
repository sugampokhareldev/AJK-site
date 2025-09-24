
const validator = require('validator');

module.exports = ({ db, enqueueDbWrite }) => {
    const submitForm = async (formData, ip) => {
        const { name, email, phone, service, message } = formData;

        const sanitizedData = {
            name: validator.escape(name.trim()).substring(0, 100),
            email: validator.normalizeEmail(email) || email,
            phone: phone ? validator.escape(phone.trim()).substring(0, 20) : '',
            service: service ? validator.escape(service.trim()).substring(0, 50) : '',
            message: validator.escape(message.trim()).substring(0, 1000)
        };
        
        return enqueueDbWrite(async () => {
            await db.read();
            const submission = {
                id: Date.now(),
                ...sanitizedData,
                submitted_at: new Date().toISOString(),
                ip: ip || 'unknown'
            };
            
            db.data.submissions.push(submission);
            await db.write();
            return submission;
        });
    };

    return { submitForm };
};
