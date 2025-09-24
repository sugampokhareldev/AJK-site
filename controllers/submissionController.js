
module.exports = ({ db, enqueueDbWrite }) => {
    const submissionService = require('../services/submissionService')({ db, enqueueDbWrite });

    const getSubmissions = async (req, res) => {
        try {
            const submissions = await submissionService.getSubmissions();
            res.json(submissions);
        } catch (err) {
            console.error('Database error:', err);
            res.status(500).json({ error: 'Database error' });
        }
    };

    const getSubmissionById = async (req, res) => {
        const id = parseInt(req.params.id);
        
        if (!id || isNaN(id)) {
            return res.status(400).json({ error: 'Invalid submission ID' });
        }
        
        try {
            const submission = await submissionService.getSubmissionById(id);
            
            if (!submission) {
                return res.status(404).json({ error: 'Submission not found' });
            }
            res.json(submission);
        } catch (err) {
            console.error('Database error:', err);
            res.status(500).json({ error: 'Database error' });
        }
    };

    const deleteSubmission = async (req, res) => {
        const id = parseInt(req.params.id);
        
        if (!id || isNaN(id)) {
            return res.status(400).json({ error: 'Invalid submission ID' });
        }
        
        try {
            const result = await submissionService.deleteSubmission(id);
            
            if (!result) {
                return res.status(404).json({ error: 'Submission not found' });
            }
            
            res.json({ success: true, message: 'Submission deleted successfully' });
        } catch (err) {
            console.error('Database error:', err);
            res.status(500).json({ error: 'Database error' });
        }
    };

    const updateSubmissionStatus = async (req, res) => {
        const id = parseInt(req.params.id);
        const { status } = req.body;

        if (!id || isNaN(id)) {
            return res.status(400).json({ error: 'Invalid submission ID' });
        }

        if (!status || !['new', 'contacted', 'scheduled', 'completed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status provided' });
        }

        try {
            const updated = await submissionService.updateSubmissionStatus(id, status);
            if (!updated) {
                return res.status(404).json({ error: 'Submission not found' });
            }
            res.json({ success: true, message: 'Submission status updated successfully', submission: updated });
        } catch (error) {
            console.error('Error updating submission status:', error);
            res.status(500).json({ error: 'Failed to update submission status' });
        }
    };

    return { getSubmissions, getSubmissionById, deleteSubmission, updateSubmissionStatus };
};
