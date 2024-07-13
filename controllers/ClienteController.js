const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');

class ClienteController
{
    static async createCliente(req, res)
    {
        try
        {
            const cliente = new Cliente(req.body);

            await cliente.save();
            res.status(201).json(cliente);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating cliente' });
        }
    }

    static async getClienti(req, res)
    {
        try
        {
            const clienti = await Cliente.find();
            res.status(200).json(clienti);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching clienti' });
        }
    }

    static async getCliente(req, res)
    {
        try
        {
            const cliente = await Cliente.findById(req.params.id);
            if (!cliente)
            {
                return res.status(404).json({ error: 'Cliente not found' });
            }
            res.status(200).json(cliente);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching cliente' });
        }
    }

    static async updateCliente(req, res)
    {
        try
        {
            const updateData = req.body;
            const cliente = await Cliente.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(cliente);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating cliente' });
        }
    }

    static async deleteCliente(req, res)
    {
        try
        {
            const cliente = await Cliente.findByIdAndDelete(req.params.id);

            if (!cliente)
            {
                return res.status(404).json({ error: 'Cliente not found' });
            }

            res.status(204).json({ message: 'Cliente deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting cliente' });
        }
    }

    static async associateContatore(req, res)
    {
        try
        {
            const cliente = await Cliente.findById(req.params.clienteId);
            const contatore = await Contatore.findById(req.params.contatoreId);

            if (!cliente || !contatore)
            {
                return res.status(404).json({ error: 'Cliente or Contatore not found' });
            }

            contatore.cliente = cliente._id;
            await contatore.save();

            res.status(200).json({ message: 'Contatore associated to Cliente', contatore });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating contatore to cliente' });
        }
    }

    static async associateFattura(req, res)
    {
        try
        {
            const cliente = await Cliente.findById(req.params.clienteId);
            const fattura = await Fattura.findById(req.params.fatturaId);

            if (!cliente || !fattura)
            {
                return res.status(404).json({ error: 'Cliente or Fattura not found' });
            }

            fattura.cliente = cliente._id;
            await fattura.save();

            res.status(200).json({ message: 'Fattura associated to Cliente', fattura });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating fattura to cliente' });
        }
    }

    static async getContatoriAssociati(req, res)
    {
        try
        {
            const contatori = await Contatore.find({ cliente: req.params.id });
            res.status(200).json(contatori);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching contatori associati' });
        }
    }

    static async getFattureAssociate(req, res)
    {
        try
        {
            const fatture = await Fattura.find({ cliente: req.params.id });
            res.status(200).json(fatture);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fatture associate' });
        }
    }
}

module.exports = ClienteController;