const Lettura = require('../models/Lettura');
const Contatore = require('../models/Contatore');
const Servizio = require('../models/Servizio');

class LetturaController
{
    static async createLettura(req, res)
    {
        try
        {
            const lettura = new Lettura(req.body);

            await lettura.save();
            res.status(201).json(lettura);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating lettura' });
        }
    }

    static async getLetture(req, res)
    {
        try
        {
            const letture = await Lettura.find().populate('contatore');
            res.status(200).json(letture);
        } 
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching letture' });
        }
    }

    static async getLettura(req, res)
    {
        try
        {
            const lettura = await Lettura.findById(req.params.id).populate('contatore');
            if (!lettura)
            {
                return res.status(404).json({ error: 'Lettura not found' });
            }
            res.status(200).json(lettura);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching lettura' });
        }
    }

    static async updateLettura(req, res)
    {
        try
        {
            const updateData = req.body;
            const lettura = await Lettura.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(lettura);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating lettura' });
        }
    }

    static async deleteLettura(req, res)
    {
        try
        {
            const lettura = await Lettura.findByIdAndDelete(req.params.id);

            if (!lettura)
            {
                return res.status(404).json({ error: 'Lettura not found' });
            }

            res.status(204).json({ message: 'Lettura deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting lettura' });
        }
    }

    static async associateContatore(req, res)
    {
        try
        {
            const lettura = await Lettura.findById(req.params.letturaId);
            const contatore = await Contatore.findById(req.params.contatoreId);

            if (!lettura || !contatore)
            {
                return res.status(404).json({ error: 'Lettura or Contatore not found' });
            }

            lettura.contatore = contatore._id;
            await lettura.save();

            res.status(200).json({ message: 'Contatore associated to Lettura', lettura });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating contatore to lettura' });
        }
    }

    static async getContatoreAssociato(req, res)
    {
        try
        {
            const lettura = await Lettura.findById(req.params.letturaId).populate('contatore');
            if (!lettura)
            {
                return res.status(404).json({ error: 'Lettura not found' });
            }
            res.status(200).json(lettura.contatore);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching contatore associato' });
        }
    }

    static async getServiziAssociati(req, res)
    {
        try
        {
            const servizi = await Servizio.find({ lettura: req.params.letturaId });
            if (!servizi || servizi.length === 0)
            {
                return res.status(404).json({ error: 'No servizi found for this lettura' });
            }
            res.status(200).json(servizi);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching servizi associati' });
        }
    }
}

module.exports = LetturaController;