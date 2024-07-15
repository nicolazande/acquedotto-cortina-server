import React, { useEffect, useState } from 'react';
import contatoreApi from '../../api/contatoreApi';
import '../../styles/Contatore/ContatoreDetails.css';

const ContatoreDetails = ({ contatoreId }) => {
    const [contatore, setContatore] = useState(null);
    const [letture, setLetture] = useState([]);
    const [showLetture, setShowLetture] = useState(false);

    useEffect(() => {
        const fetchContatore = async () => {
            try {
                const response = await contatoreApi.getContatore(contatoreId);
                setContatore(response.data);
            } catch (error) {
                alert('Errore durante il recupero del contatore');
                console.error(error);
            }
        };

        if (contatoreId) {
            fetchContatore();
        }
    }, [contatoreId]);

    const fetchLetture = async () => {
        try {
            const response = await contatoreApi.getLetture(contatoreId);
            setLetture(response.data);
            setShowLetture(true);
        } catch (error) {
            alert('Errore durante il recupero delle letture');
            console.error(error);
        }
    };

    if (!contatore) {
        return <div>Seleziona un contatore per vedere i dettagli</div>;
    }

    return (
        <div className="contatore-detail">
            <h2>Dettagli Contatore</h2>
            <table className="info-table">
                <tbody>
                    <tr>
                        <th>Seriale</th>
                        <td>{contatore.seriale}</td>
                    </tr>
                    <tr>
                        <th>Seriale Interno</th>
                        <td>{contatore.serialeInterno}</td>
                    </tr>
                    <tr>
                        <th>Ultima Lettura</th>
                        <td>{new Date(contatore.ultimaLettura).toLocaleDateString()}</td>
                    </tr>
                    <tr>
                        <th>Attivo</th>
                        <td>{contatore.attivo ? 'Sì' : 'No'}</td>
                    </tr>
                    <tr>
                        <th>Condominiale</th>
                        <td>{contatore.condominiale ? 'Sì' : 'No'}</td>
                    </tr>
                    <tr>
                        <th>Sostituzione</th>
                        <td>{contatore.sostituzione ? 'Sì' : 'No'}</td>
                    </tr>
                    <tr>
                        <th>Subentro</th>
                        <td>{contatore.subentro ? 'Sì' : 'No'}</td>
                    </tr>
                    <tr>
                        <th>Data Installazione</th>
                        <td>{new Date(contatore.dataInstallazione).toLocaleDateString()}</td>
                    </tr>
                    <tr>
                        <th>Data Scadenza</th>
                        <td>{new Date(contatore.dataScadenza).toLocaleDateString()}</td>
                    </tr>
                    <tr>
                        <th>Note</th>
                        <td>{contatore.note}</td>
                    </tr>
                    <tr>
                        <th>Cliente</th>
                        <td>{contatore.cliente ? `${contatore.cliente.nome} ${contatore.cliente.cognome}` : 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Edificio</th>
                        <td>{contatore.edificio ? contatore.edificio.descrizione : 'N/A'}</td>
                    </tr>
                </tbody>
            </table>
            <button onClick={fetchLetture} className="btn-show-letture">Visualizza Letture</button>
            {showLetture && (
                <div className="letture-section">
                    <h3>Letture Associate</h3>
                    <table className="letture-table">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Valore</th>
                                <th>UdM</th>
                                <th>Fatturata</th>
                                <th>Note</th>
                            </tr>
                        </thead>
                        <tbody>
                            {letture.map((lettura) => (
                                <tr key={lettura._id}>
                                    <td>{new Date(lettura.data).toLocaleDateString()}</td>
                                    <td>{lettura.valore}</td>
                                    <td>{lettura.UdM}</td>
                                    <td><input type="checkbox" checked={lettura.fatturata} readOnly /></td>
                                    <td>{lettura.note}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default ContatoreDetails;
