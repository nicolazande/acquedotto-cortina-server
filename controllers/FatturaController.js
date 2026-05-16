const Fattura = require('../models/Fattura');
const Cliente = require('../models/Cliente');
const Servizio = require('../models/Servizio');
const Scadenza = require('../models/Scadenza');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    createInvoiceFromReadings,
    previewBillingBatch,
    verifyInvoiceCalculation,
} = require('../services/invoiceGenerator');
const { generateInvoicePdf } = require('../services/invoicePdf');

class FatturaController
{
    static async createFattura(req, res) {
        try {
            const currentYear = new Date().getFullYear(); // Get the current year

            // Find the highest numero for the current year
            const highestFattura = await Fattura.findOne({ anno: currentYear })
                .sort({ numero: -1 })
                .limit(1)
                .select('numero');

            // Determine the new numero
            const newNumero = highestFattura ? highestFattura.numero + 1 : 0;

            // Create the new fattura with anno and numero
            const fattura = new Fattura({
                ...req.body,
                anno: currentYear,
                numero: newNumero,
            });

            await fattura.save();

            res.status(201).json(fattura);
        } catch (error) {
            console.error(error);
            res.status(400).json({ error: 'Error creating fattura' });
        }
    }

    static async getFatture(req, res) {
        return sendPaginated(Fattura, req, res, {
            defaultSort: 'data_fattura',
            errorMessage: 'Error fetching fatture',
            populate: 'cliente scadenza',
        });
    }

    static async generateFromReadings(req, res)
    {
        try
        {
            const result = await createInvoiceFromReadings({
                letture: req.body.letture || req.body.letturaIds,
                data_fattura: req.body.data_fattura,
                tipo_documento: req.body.tipo_documento,
                confermata: req.body.confermata,
            });

            res.status(201).json(result);
        }
        catch (error)
        {
            console.error(error);
            res.status(error.status || 400).json({ error: error.message || 'Error generating fattura' });
        }
    }

    static async getGenerationPreview(req, res)
    {
        try
        {
            const result = await previewBillingBatch({ limit: req.query.limit });
            res.status(200).json(result);
        }
        catch (error)
        {
            console.error(error);
            res.status(error.status || 500).json({ error: error.message || 'Error fetching billing generation preview' });
        }
    }

    static async getFattura(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.id).populate('cliente scadenza');
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

    static async verifyCalcolo(req, res)
    {
        try
        {
            const result = await verifyInvoiceCalculation(req.params.id);
            res.status(200).json(result);
        }
        catch (error)
        {
            console.error(error);
            res.status(error.status || 500).json({ error: error.message || 'Error verifying fattura calculation' });
        }
    }

    static async downloadPdf(req, res)
    {
        try
        {
            const { buffer, filename } = await generateInvoicePdf(req.params.id);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
            res.setHeader('Content-Length', buffer.length);
            res.status(200).send(buffer);
        }
        catch (error)
        {
            console.error(error);
            res.status(error.status || 500).json({ error: error.message || 'Error generating fattura PDF' });
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

    static async associateScadenza(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.fatturaId);
            const scadenza = await Scadenza.findById(req.params.scadenzaId);

            if (!fattura || !scadenza)
            {
                return res.status(404).json({ error: 'Fattura or Scadenza not found' });
            }

            fattura.scadenza = scadenza._id;
            await fattura.save();

            res.status(200).json({ message: 'Scadenza associated to Fattura', scadenza });
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error associating scadenza to fattura' });
        }
    }

    static async getServiziAssociati(req, res)
    {
        try
        {
            const servizi = await Servizio.find({ fattura: req.params.id }).populate('lettura articolo listino fascia');
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
            const fattura = await Fattura.findById(req.params.id).populate('cliente');
            if (!fattura)
            {
                return res.status(404).json({ error: 'Fattura not found' });
            }
            res.status(200).json(fattura.cliente);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching cliente associato' });
        }
    }

    static async getScadenzaAssociata(req, res)
    {
        try
        {
            const fattura = await Fattura.findById(req.params.id).populate('scadenza');
            if (!fattura)
            {
                return res.status(404).json({ error: 'Fattura not found' });
            }
            res.status(200).json(fattura.scadenza);
        }
        catch (error)
        {
            console.error(error);
            res.status(500).json({ error: 'Error fetching scadenza associato' });
        }
    }
}

module.exports = FatturaController;
