const Contatore = require('../models/Contatore');
const Cliente = require('../models/Cliente');
const Edificio = require('../models/Edificio');
const Listino = require('../models/Listino');
const Lettura = require('../models/Lettura');

class ContatoreController
{
    static async createContatore(req, res)
    {
        try
        {
            const contatore = new Contatore(req.body);

            await contatore.save();
            res.status(201).json(contatore);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating contatore' });
        }
    }

    static async getContatori(req, res)
    {
        try
        {
            const contatori = await Contatore.find().populate('edificio listino cliente');
            res.status(200).json(contatori);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching contatori' });
        }
    }

    static async getContatore(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.id).populate('edificio listino cliente');
            if (!contatore)
            {
                return res.status(404).json({ error: 'Contatore not found' });
            }
            res.status(200).json(contatore);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching contatore' });
        }
    }

    static async updateContatore(req, res)
    {
        try
        {
            const updateData = req.body;
            const contatore = await Contatore.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(contatore);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating contatore' });
        }
    }

    static async deleteContatore(req, res)
    {
        try
        {
            const contatore = await Contatore.findByIdAndDelete(req.params.id);

            if (!contatore)
            {
                return res.status(404).json({ error: 'Contatore not found' });
            }

            res.status(204).json({ message: 'Contatore deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting contatore' });
        }
    }

    static async associateCliente(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.contatoreId);
            const cliente = await Cliente.findById(req.params.clienteId);

            if (!contatore || !cliente)
            {
                return res.status(404).json({ error: 'Contatore or Cliente not found' });
            }

            contatore.cliente = cliente._id;
            await contatore.save();

            res.status(200).json({ message: 'Cliente associated to Contatore', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating cliente to contatore' });
        }
    }

    static async associateEdificio(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.contatoreId);
            const edificio = await Edificio.findById(req.params.edificioId);

            if (!contatore || !edificio)
            {
                return res.status(404).json({ error: 'Contatore or Edificio not found' });
            }

            contatore.edificio = edificio._id;
            await contatore.save();

            res.status(200).json({ message: 'Edificio associated to Contatore', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating edificio to contatore' });
        }
    }

    static async associateListino(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.contatoreId);
            const listino = await Listino.findById(req.params.listinoId);

            if (!contatore || !listino)
            {
                return res.status(404).json({ error: 'Contatore or Listino not found' });
            }

            contatore.listino = listino._id;
            await contatore.save();

            res.status(200).json({ message: 'Listino associated to Contatore', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating listino to contatore' });
        }
    }

    static async getListinoAssociato(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.id).populate('listino');
            if (!contatore || !contatore.listino)
            {
                return res.status(404).json({ error: 'Contatore or Listino not found' });
            }
            res.status(200).json(contatore.listino);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching listino associato' });
        }
    }

    static async getEdificioAssociato(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.id).populate('edificio');
            if (!contatore || !contatore.edificio)
            {
                return res.status(404).json({ error: 'Contatore or Edificio not found' });
            }
            res.status(200).json(contatore.edificio);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching edificio associato' });
        }
    }

    static async getLettureAssociate(req, res)
    {
        try
        {
            const letture = await Lettura.find({ contatore: req.params.id });
            res.status(200).json(letture);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching letture associate' });
        }
    }

    static async getClienteAssociato(req, res)
    {
        try
        {
            const contatore = await Contatore.findById(req.params.id).populate('cliente');
            if (!contatore || !contatore.cliente)
            {
                return res.status(404).json({ error: 'Contatore or Cliente not found' });
            }
            res.status(200).json(contatore.cliente);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching cliente associato' });
        }
    }
}

module.exports = ContatoreController;