const Articolo = require('../models/Articolo');
const Servizio = require('../models/Servizio');

class ArticoloController
{
    static async createArticolo(req, res)
    {
        try
        {
            const { codice, descrizione, iva } = req.body;
            const articolo = new Articolo({ codice, descrizione, iva });

            await articolo.save();
            res.status(201).json(articolo);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating articolo' });
        }
    }

    static async getArticoli(req, res)
    {
        try
        {
            const articoli = await Articolo.find();
            res.status(200).json(articoli);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching articoli' });
        }
    }

    static async getArticolo(req, res)
    {
        try
        {
            const articolo = await Articolo.findById(req.params.id);
            if (!articolo)
            {
                return res.status(404).json({ error: 'Articolo not found' });
            }
            res.status(200).json(articolo);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching articolo' });
        }
    }

    static async updateArticolo(req, res)
    {
        try
        {
            const updateData = req.body;
            const articolo = await Articolo.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(articolo);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating articolo' });
        }
    }

    static async deleteArticolo(req, res)
    {
        try
        {
            const articolo = await Articolo.findByIdAndDelete(req.params.id);

            if (!articolo)
            {
                return res.status(404).json({ error: 'Articolo not found' });
            }

            res.status(204).json({ message: 'Articolo deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting articolo' });
        }
    }

    static async associateServizio(req, res)
    {
        try
        {
            const articolo = await Articolo.findById(req.params.articoloId);
            const servizio = await Servizio.findById(req.params.servizioId);

            if (!articolo || !servizio)
            {
                return res.status(404).json({ error: 'Articolo or Servizio not found' });
            }

            servizio.articolo = articolo._id;
            await servizio.save();

            res.status(200).json({ message: 'Servizio associated to Articolo', servizio });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating servizio to articolo' });
        }
    }

    static async getServiziAssociati(req, res)
    {
        try
        {
            const servizi = await Servizio.find({ articolo: req.params.id });
            res.status(200).json(servizi);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching servizi associati' });
        }
    }
}

module.exports = ArticoloController;