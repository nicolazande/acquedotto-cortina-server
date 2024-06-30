// client/src/App.js
import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import UserForm from './components/UserForm';
import UserList from './components/UserList';

const App = () => (
    <Router>
        <Navbar />
        <Switch>
            <Route path="/" exact component={Home} />
            <Route path="/register" component={UserForm} />
            <Route path="/view-users" component={UserList} />
        </Switch>
    </Router>
);

export default App;
