const Listino = require('../models/Listino');
const Fascia = require('../models/Fascia');
const Contatore = require('../models/Contatore');

class ListinoController
{
    static async createListino(req, res)
    {
        try
        {
            const listino = new Listino(req.body);

            await listino.save();
            res.status(201).json(listino);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating listino' });
        }
    }

    static async getListini(req, res)
    {
        try
        {
            const listini = await Listino.find();
            res.status(200).json(listini);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching listini' });
        }
    }

    static async getListino(req, res)
    {
        try
        {
            const listino = await Listino.findById(req.params.id);
            if (!listino)
            {
                return res.status(404).json({ error: 'Listino not found' });
            }
            res.status(200).json(listino);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching listino' });
        }
    }

    static async updateListino(req, res)
    {
        try
        {
            const updateData = req.body;
            const listino = await Listino.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(listino);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating listino' });
        }
    }

    static async deleteListino(req, res)
    {
        try
        {
            const listino = await Listino.findByIdAndDelete(req.params.id);

            if (!listino)
            {
                return res.status(404).json({ error: 'Listino not found' });
            }

            res.status(204).json({ message: 'Listino deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting listino' });
        }
    }

    static async associateFascia(req, res)
    {
        try
        {
            const listino = await Listino.findById(req.params.listinoId);
            const fascia = await Fascia.findById(req.params.fasciaId);

            if (!listino || !fascia)
            {
                return res.status(404).json({ error: 'Listino or Fascia not found' });
            }

            fascia.listino = listino._id;
            await fascia.save();

            res.status(200).json({ message: 'Fascia associated to Listino', fascia });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating fascia to listino' });
        }
    }

    static async getFasceAssociate(req, res)
    {
        try
        {
            const fasce = await Fascia.find({ listino: req.params.id });
            res.status(200).json(fasce);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fasce associate' });
        }
    }

    static async associateContatore(req, res)
    {
        try
        {
            const listino = await Listino.findById(req.params.listinoId);
            const contatore = await Contatore.findById(req.params.contatoreId);

            if (!listino || !contatore)
            {
                return res.status(404).json({ error: 'Listino or Contatore not found' });
            }

            contatore.listino = listino._id;
            await contatore.save();

            res.status(200).json({ message: 'Contatore associated to Listino', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating contatore to listino' });
        }
    }

    static async getContatoriAssociati(req, res)
    {
        try
        {
            const contatori = await Contatore.find({ listino: req.params.id });
            res.status(200).json(contatori);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching contatori associati' });
        }
    }
}

module.exports = ListinoController;