const Edificio = require('../models/Edificio');
const Contatore = require('../models/Contatore');

class EdificioController
{
    static async createEdificio(req, res)
    {
        try
        {
            const edificio = new Edificio(req.body);
            await edificio.save();
            res.status(201).json(edificio);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating edificio' });
        }
    }

    static async getEdifici(req, res)
    {
        try
        {
            const edifici = await Edificio.find();
            res.status(200).json(edifici);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching edifici' });
        }
    }

    static async getEdificio(req, res)
    {
        try
        {
            const edificio = await Edificio.findById(req.params.id);
            if (!edificio)
            {
                return res.status(404).json({ error: 'Edificio not found' });
            }
            res.status(200).json(edificio);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching edificio' });
        }
    }

    static async updateEdificio(req, res)
    {
        try
        {
            const updateData = req.body;
            const edificio = await Edificio.findByIdAndUpdate(req.params.id, updateData, { new: true });
            res.status(200).json(edificio);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating edificio' });
        }
    }

    static async deleteEdificio(req, res)
    {
        try
        {
            const edificio = await Edificio.findByIdAndDelete(req.params.id);
            if (!edificio)
            {
                return res.status(404).json({ error: 'Edificio not found' });
            }
            res.status(204).json({ message: 'Edificio deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting edificio' });
        }
    }

    static async associateContatore(req, res)
    {
        try
        {
            const edificio = await Edificio.findById(req.params.edificioId);
            const contatore = await Contatore.findById(req.params.contatoreId);
            if (!edificio || !contatore)
            {
                return res.status(404).json({ error: 'Edificio or Contatore not found' });
            }
            contatore.edificio = edificio._id;
            await contatore.save();
            res.status(200).json({ message: 'Contatore associated to Edificio', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating contatore to edificio' });
        }
    }

    static async getContatoriAssociati(req, res)
    {
        try
        {
            const contatori = await Contatore.find({ edificio: req.params.edificioId }).populate('cliente');
            if (!contatori || contatori.length === 0)
            {
                return res.status(404).json({ error: 'No contatori found for this edificio' });
            }
            res.status(200).json(contatori);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching contatori associati' });
        }
    }
}

module.exports = EdificioController;