import { initStaffPage } from './staff-layout.js';
import { mountReceiptsPage } from './receipts-page.js';

const shell = await initStaffPage({ active: 'receipts', title: 'রিসিট ও পেমেন্ট' });
await mountReceiptsPage({ shell, role: 'staff' });
