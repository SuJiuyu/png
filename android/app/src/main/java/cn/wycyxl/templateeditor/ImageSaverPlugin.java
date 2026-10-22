package cn.wycyxl.templateeditor;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

@CapacitorPlugin(name = "ImageSaver")
public class ImageSaverPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name");
        String mimeType = call.getString("mimeType");
        String base64 = call.getString("base64");
        if (name == null || base64 == null ||
            !("image/png".equals(mimeType) || "image/jpeg".equals(mimeType))) {
            call.reject("Invalid image export");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "onSaveResult");
    }

    @ActivityCallback
    private void onSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject response = new JSObject();
            response.put("saved", false);
            call.resolve(response);
            return;
        }

        Uri destination = data.getData();
        try {
            byte[] bytes = Base64.decode(call.getString("base64"), Base64.DEFAULT);
            try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) throw new IllegalStateException("No writable output stream");
                output.write(bytes);
            }
            JSObject response = new JSObject();
            response.put("saved", true);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not save image", error);
        }
    }
}
