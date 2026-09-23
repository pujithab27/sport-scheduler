import { app } from './app.js';
import { bootstrapAdmin } from './bootstrap-admin.js';
await bootstrapAdmin();
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Sport Scheduler running at http://localhost:${port}`));
