
module.exports = ({ db, enqueueDbWrite }) => {
    const getSubmissions = async () => {
        await db.read();
        return [...db.data.submissions].reverse();
    };

    const getSubmissionById = async (id) => {
        await db.read();
        return db.data.submissions.find(s => s.id === id);
    };

    const deleteSubmission = async (id) => {
        return enqueueDbWrite(async () => {
            await db.read();
            const initialLength = db.data.submissions.length;
            db.data.submissions = db.data.submissions.filter(s => s.id !== id);
            
            if (db.data.submissions.length === initialLength) {
                return false;
            }
            
            await db.write();
            return true;
        });
    };

    const updateSubmissionStatus = async (id, status) => {
        return enqueueDbWrite(async () => {
            await db.read();
            const submission = db.data.submissions.find(s => s.id === id);
            if (submission) {
                submission.status = status;
                await db.write();
                return submission;
            }
            return null;
        });
    };

    return { getSubmissions, getSubmissionById, deleteSubmission, updateSubmissionStatus };
};
