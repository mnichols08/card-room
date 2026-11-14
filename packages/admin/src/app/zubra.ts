// The Zubra components this app uses. `npm run zubra` compiles the card room's shared components
// (packages/ui/src: our own, and the ones copied from zubra-ui) into custom elements in ../../zubra;
// importing one defines its tag, and Angular templates use the tags as they are
// (CUSTOM_ELEMENTS_SCHEMA): properties in with [prop], events out with (event), and
// `zubraModel` from @zubra/runtime/angular for ngModel.
import "../../zubra/playing-card.js";
import "../../zubra/zubra-ui/action-button.js";
import "../../zubra/zubra-ui/alert-banner.js";
import "../../zubra/zubra-ui/auto-grid.js";
import "../../zubra/zubra-ui/cluster-layout.js";
import "../../zubra/zubra-ui/content-card.js";
import "../../zubra/zubra-ui/data-table.js";
import "../../zubra/zubra-ui/empty-state.js";
import "../../zubra/zubra-ui/loading-spinner.js";
import "../../zubra/zubra-ui/modal-dialog.js";
import "../../zubra/zubra-ui/segmented-control.js";
import "../../zubra/zubra-ui/stack-layout.js";
import "../../zubra/zubra-ui/stat-card.js";
import "../../zubra/zubra-ui/status-badge.js";
import "../../zubra/zubra-ui/tab-list.js";
import "../../zubra/zubra-ui/text-field.js";
import "../../zubra/zubra-ui/toast-region.js";
import "../../zubra/zubra-ui/user-avatar.js";
