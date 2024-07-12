const Servizio = require('../models/Servizio');
const Lettura = require('../models/Lettura');
const Articolo = require('../models/Articolo');
const Fattura = require('../models/Fattura');

class ServizioController
{
    static async createServizio(req, res)
    {
        try
        {
            const servizio = new Servizio(req.body);

            await servizio.save();
            res.status(201).json(servizio);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating servizio' });
        }
    }

    static async getServizi(req, res)
    {
        try
        {
            const servizi = await Servizio.find().populate('lettura articolo fattura');
            res.status(200).json(servizi);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching servizi' });
        }
    }

    static async getServizio(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.id).populate('lettura articolo fattura');
            if (!servizio)
            {
                return res.status(404).json({ error: 'Servizio not found' });
            }
            res.status(200).json(servizio);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching servizio' });
        }
    }

    static async updateServizio(req, res)
    {
        try
        {
            const updateData = req.body;
            const servizio = await Servizio.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(servizio);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating servizio' });
        }
    }

    static async deleteServizio(req, res)
    {
        try
        {
            const servizio = await Servizio.findByIdAndDelete(req.params.id);

            if (!servizio)
            {
                return res.status(404).json({ error: 'Servizio not found' });
            }

            res.status(204).json({ message: 'Servizio deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting servizio' });
        }
    }

    static async associateLettura(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.servizioId);
            const lettura = await Lettura.findById(req.params.letturaId);

            if (!servizio || !lettura)
            {
                return res.status(404).json({ error: 'Servizio or Lettura not found' });
            }

            servizio.lettura = lettura._id;
            await servizio.save();

            res.status(200).json({ message: 'Lettura associated to Servizio', servizio });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating lettura to servizio' });
        }
    }

    static async associateArticolo(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.servizioId);
            const articolo = await Articolo.findById(req.params.articoloId);

            if (!servizio || !articolo)
            {
                return res.status(404).json({ error: 'Servizio or Articolo not found' });
            }

            servizio.articolo = articolo._id;
            await servizio.save();

            res.status(200).json({ message: 'Articolo associated to Servizio', servizio });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating articolo to servizio' });
        }
    }

    static async associateFattura(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.servizioId);
            const fattura = await Fattura.findById(req.params.fatturaId);

            if (!servizio || !fattura)
            {
                return res.status(404).json({ error: 'Servizio or Fattura not found' });
            }

            servizio.fattura = fattura._id;
            await servizio.save();

            res.status(200).json({ message: 'Fattura associated to Servizio', servizio });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating fattura to servizio' });
        }
    }

    static async getLetturaAssociata(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.servizioId).populate('lettura');
            if (!servizio || !servizio.lettura)
            {
                return res.status(404).json({ error: 'Lettura not found' });
            }
            res.status(200).json(servizio.lettura);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching lettura associata' });
        }
    }

    static async getFatturaAssociata(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.servizioId).populate('fattura');
            if (!servizio || !servizio.fattura)
            {
                return res.status(404).json({ error: 'Fattura not found' });
            }
            res.status(200).json(servizio.fattura);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fattura associata' });
        }
    }

    static async getArticoloAssociato(req, res)
    {
        try
        {
            const servizio = await Servizio.findById(req.params.servizioId).populate('articolo');
            if (!servizio || !servizio.articolo)
            {
                return res.status(404).json({ error: 'Articolo not found' });
            }
            res.status(200).json(servizio.articolo);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching articolo associato' });
        }
    }
}

module.exports = ServizioController;