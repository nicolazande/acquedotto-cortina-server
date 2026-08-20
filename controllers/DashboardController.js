const { sendServiceError } = require('./utils/controllerActions');
const { getDashboard } = require('../services/dashboardService');

const getPanoramica = async (req, res) => {
    try {
        const panoramica = await getDashboard();
        res.status(200).json(panoramica);
    } catch (error) {
        sendServiceError(res, error, 'Error fetching panoramica');
    }
};

module.exports = {
    getPanoramica,
};
