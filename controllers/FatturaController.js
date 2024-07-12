const Fattura = require('../models/Fattura');
const Cliente = require('../models/Cliente');
const Servizio = require('../models/Servizio');

class FatturaController
{
    static async createFattura(req, res)
    {
        try
        {
            const fattura = new Fattura(req.body);

            await fattura.save();
            res.status(201).json(fattura);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating fattura' });
        }
    }

    static async getFatture(req, res)
    {
        try
        {
            const fatture = await Fattura.find().populate('cliente');
            res.status(200).json(fatture);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fatture' });
        }
    }

    static async getFattura(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.id).populate('cliente');
            if (!fattura)
            {
                return res.status(404).json({ error: 'Fattura not found' });
            }
            res.status(200).json(fattura);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fattura' });
        }
    }

    static async updateFattura(req, res)
    {
        try
        {
            const updateData = req.body;
            const fattura = await Fattura.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(fattura);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating fattura' });
        }
    }

    static async deleteFattura(req, res)
    {
        try
        {
            const fattura = await Fattura.findByIdAndDelete(req.params.id);

            if (!fattura)
            {
                return res.status(404).json({ error: 'Fattura not found' });
            }

            res.status(204).json({ message: 'Fattura deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting fattura' });
        }
    }

    static async associateCliente(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.fatturaId);
            const cliente = await Cliente.findById(req.params.clienteId);

            if (!fattura || !cliente)
            {
                return res.status(404).json({ error: 'Fattura or Cliente not found' });
            }

            fattura.cliente = cliente._id;
            await fattura.save();

            res.status(200).json({ message: 'Cliente associated to Fattura', fattura });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating cliente to fattura' });
        }
    }

    static async associateServizio(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.fatturaId);
            const servizio = await Servizio.findById(req.params.servizioId);

            if (!fattura || !servizio)
            {
                return res.status(404).json({ error: 'Fattura or Servizio not found' });
            }

            servizio.fattura = fattura._id;
            await servizio.save();

            res.status(200).json({ message: 'Servizio associated to Fattura', servizio });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating servizio to fattura' });
        }
    }

    static async getServiziAssociati(req, res)
    {
        try
        {
            const servizi = await Servizio.find({ fattura: req.params.fatturaId });
            res.status(200).json(servizi);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching servizi associati' });
        }
    }

    static async getClienteAssociato(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.fatturaId).populate('cliente');
            if (!fattura || !fattura.cliente)
            {
                return res.status(404).json({ error: 'Cliente not found' });
            }
            res.status(200).json(fattura.cliente);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching cliente associato' });
        }
    }
}

module.exports = FatturaController;