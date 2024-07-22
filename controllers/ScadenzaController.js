const Scadenza = require('../models/Scadenza');
const Fattura = require('../models/Fattura');

class ScadenzaController
{
    static async createScadenza(req, res)
    {
        try
        {
            const scadenza = new Scadenza(req.body);

            await scadenza.save();
            res.status(201).json(scadenza);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error creating scadenza' });
        }
    }

    static async getScadenze(req, res)
    {
        try
        {
            const scadenze = await Scadenza.find().populate('fattura');
            res.status(200).json(scadenze);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching scadenze' });
        }
    }

    static async getScadenza(req, res)
    {
        try
        {
            const scadenza = await Scadenza.findById(req.params.id).populate('fattura');
            if (!scadenza)
            {
                return res.status(404).json({ error: 'Scadenza not found' });
            }
            res.status(200).json(scadenza);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching scadenza' });
        }
    }

    static async updateScadenza(req, res)
    {
        try
        {
            const updateData = req.body;
            const scadenza = await Scadenza.findByIdAndUpdate(req.params.id, updateData, { new: true });

            res.status(200).json(scadenza);
        }
        catch (error)
        {
            console.error(error);
            res.status(400).json({ error: 'Error updating scadenza' });
        }
    }

    static async deleteScadenza(req, res)
    {
        try
        {
            const scadenza = await Scadenza.findByIdAndDelete(req.params.id);

            if (!scadenza)
            {
                return res.status(404).json({ error: 'Scadenza not found' });
            }

            res.status(204).json({ message: 'Scadenza deleted' });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error deleting scadenza' });
        }
    }

    static async associateFattura(req, res)
    {
        try
        {
            const scadenza = await Scadenza.findById(req.params.scadenzaId);
            const fattura = await Fattura.findById(req.params.fatturaId);

            if (!scadenza || !fattura)
            {
                return res.status(404).json({ error: 'Scadenza or Fattura not found' });
            }

            scadenza.fattura = fattura._id;
            await scadenza.save();

            res.status(200).json({ message: 'Fattura associated to Scadenza', scadenza });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating fattura to scadenza' });
        }
    }

    static async getFatturaAssociata(req, res)
    {
        try
        {
            const scadenza = await Scadenza.findById(req.params.id).populate('fattura');
            if (!scadenza || !scadenza.fattura)
            {
                return res.status(404).json({ error: 'Fattura not found' });
            }
            res.status(200).json(scadenza.fattura);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching fattura associata' });
        }
    }
}

module.exports = ScadenzaController;