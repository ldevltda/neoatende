import React from "react";
import { Switch, Route } from "react-router-dom";
import InventoryIntegrationsPage from "../pages/inventory/InventoryIntegrationsPage";

export default function InventoryRoutes() {
  return (
    <Switch>
      <Route exact path="/admin/inventory" component={InventoryIntegrationsPage} />
    </Switch>
  );
}
