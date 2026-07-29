// Ghidra headless postScript (Java — no PyGhidra needed).
// Prints inferred function entry points as a machine-parseable line:
//   GHIDRA_FUNCS=0x..,0x..,...
//   GHIDRA_FUNC_COUNT=N
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import java.util.ArrayList;
import java.util.Collections;

public class GhidraListFunctions extends GhidraScript {
    @Override
    public void run() throws Exception {
        FunctionManager fm = currentProgram.getFunctionManager();
        ArrayList<Long> addrs = new ArrayList<>();
        for (Function f : fm.getFunctions(true)) {
            addrs.add(f.getEntryPoint().getOffset());
        }
        Collections.sort(addrs);
        StringBuilder sb = new StringBuilder("GHIDRA_FUNCS=");
        for (int i = 0; i < addrs.size(); i++) {
            if (i > 0) {
                sb.append(",");
            }
            sb.append("0x").append(Long.toHexString(addrs.get(i)));
        }
        println(sb.toString());
        println("GHIDRA_FUNC_COUNT=" + addrs.size());
    }
}
