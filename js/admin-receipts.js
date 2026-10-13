import { initAdminPage } from './layout.js';
import { mountReceiptsPage } from './receipts-page.js';

const shell = await initAdminPage({ active: 'receipts', title: 'রিসিট ও পেমেন্ট' });
await mountReceiptsPage({ shell, role: 'admin' });
