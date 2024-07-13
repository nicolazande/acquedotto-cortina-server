const Fascia = require('../models/Fascia');
const Listino = require('../models/Listino');

class FasciaController
{
    static async createFascia(req, res)
    {
        try
        {
            const { tipo, min, max, prezzo, scadenza, fisso } = req.body;
            const fascia = new Fascia({ tipo, min, max, prezzo, scadenza, fisso });

            await fascia.save();
            res.status(201).json(fascia);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating fascia' });
        }
    }

    static async getFasce(req, res)
    {
        try
        {
            const fasce = await Fascia.find();
            res.status(200).json(fasce);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fasce' });
        }
    }

    static async getFascia(req, res)
    {
        try
        {
            const fascia = await Fascia.findById(req.params.id);
            if (!fascia)
            {
                return res.status(404).json({ error: 'Fascia not found' });
            }
            res.status(200).json(fascia);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fascia' });
        }
    }

    static async updateFascia(req, res)
    {
        try
        {
            const updateData = req.body;
            const fascia = await Fascia.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(fascia);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating fascia' });
        }
    }

    static async deleteFascia(req, res)
    {
        try
        {
            const fascia = await Fascia.findByIdAndDelete(req.params.id);

            if (!fascia)
            {
                return res.status(404).json({ error: 'Fascia not found' });
            }

            res.status(204).json({ message: 'Fascia deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting fascia' });
        }
    }

    static async associateListino(req, res)
    {
        try
        {
            const fascia = await Fascia.findById(req.params.fasciaId);
            const listino = await Listino.findById(req.params.listinoId);

            if (!fascia || !listino)
            {
                return res.status(404).json({ error: 'Fascia or Listino not found' });
            }

            fascia.listino = listino._id;
            await fascia.save();

            res.status(200).json({ message: 'Listino associated to Fascia', fascia });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating listino to fascia' });
        }
    }

    static async getListinoAssociato(req, res)
    {
        try
        {
            const fascia = await Fascia.findById(req.params.id).populate('listino');
            if (!fascia || !fascia.listino)
            {
                return res.status(404).json({ error: 'Fascia or Listino not found' });
            }
            res.status(200).json(fascia.listino);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching listino associato' });
        }
    }
}

module.exports = FasciaController;