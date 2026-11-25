// Dashboard and status's door for the host programs (tools/dashboard/): the gateway token and the dashboard process, which the host's hosting and build
// controller start and address.
export { configureDashboardGateway, DASHBOARD_PORT, gatewayHeaders } from './gateway-access.ts';
export { launch, stop } from './process.ts';
// Table K's key check route, which the lifecycle owner's pairing (tools/hosting/authorize.ts) asks with a key.
export { APP_VERIFY } from '../../runtime/status/coordinator/routes.ts';
