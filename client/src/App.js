// client/src/App.js
import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import RegisterUser from './pages/RegisterUser';
import ViewUsers from './pages/ViewUsers';

const App = () => (
    <Router>
        <Navbar />
        <Switch>
            <Route path="/" exact component={Home} />
            <Route path="/register" component={RegisterUser} />
            <Route path="/view-users" component={ViewUsers} />
        </Switch>
    </Router>
);

export default App;
