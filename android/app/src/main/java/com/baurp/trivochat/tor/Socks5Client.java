package com.baurp.trivochat.tor;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * Minimal SOCKS5 client speaking directly to the local tor daemon.
 *
 * Tor exposes .onion hostnames only through SOCKS5 "domain name" CONNECT
 * requests (RFC 1928 ATYP 0x03) — the name must never be resolved locally,
 * otherwise the request leaks and fails. This class therefore always sends the
 * hostname verbatim and lets tor perform the rendezvous.
 */
public final class Socks5Client {

    private Socks5Client() {
    }

    /** Wire framing: 4-byte big-endian length + UTF-8 JSON payload. */
    public static final int MAX_FRAME_BYTES = 8 * 1024 * 1024;

    public static Socket connect(int socksPort, String host, int port, int timeoutMs)
            throws IOException {
        Socket socket = new Socket();
        socket.setSoTimeout(timeoutMs);
        socket.connect(new InetSocketAddress("127.0.0.1", socksPort), timeoutMs);

        OutputStream out = socket.getOutputStream();
        InputStream in = socket.getInputStream();

        // Greeting: VER=5, one method, 0x00 (no auth).
        out.write(new byte[]{0x05, 0x01, 0x00});
        out.flush();

        byte[] greeting = readFully(in, 2);
        if (greeting[0] != 0x05 || greeting[1] != 0x00) {
            socket.close();
            throw new IOException("SOCKS5 handshake rejected by tor (method "
                    + (greeting[1] & 0xFF) + ")");
        }

        byte[] hostBytes = host.getBytes(StandardCharsets.US_ASCII);
        if (hostBytes.length > 255) {
            socket.close();
            throw new IOException("onion hostname too long");
        }

        byte[] request = new byte[7 + hostBytes.length];
        request[0] = 0x05;            // VER
        request[1] = 0x01;            // CMD = CONNECT
        request[2] = 0x00;            // RSV
        request[3] = 0x03;            // ATYP = DOMAINNAME
        request[4] = (byte) hostBytes.length;
        System.arraycopy(hostBytes, 0, request, 5, hostBytes.length);
        request[5 + hostBytes.length] = (byte) ((port >> 8) & 0xFF);
        request[6 + hostBytes.length] = (byte) (port & 0xFF);
        out.write(request);
        out.flush();

        byte[] head = readFully(in, 4);
        if (head[0] != 0x05) {
            socket.close();
            throw new IOException("SOCKS5 bad reply version");
        }
        int status = head[1] & 0xFF;
        if (status != 0x00) {
            socket.close();
            throw new IOException("SOCKS5 connect failed, status=" + status);
        }
        int atyp = head[3] & 0xFF;
        if (atyp == 0x01) {
            readFully(in, 4 + 2);
        } else if (atyp == 0x03) {
            byte[] len = readFully(in, 1);
            readFully(in, (len[0] & 0xFF) + 2);
        } else if (atyp == 0x04) {
            readFully(in, 16 + 2);
        } else {
            socket.close();
            throw new IOException("SOCKS5 unknown address type " + atyp);
        }
        return socket;
    }

    /** Opens a circuit purely to prove the hidden service is up, then closes it. */
    public static boolean probe(int socksPort, String host, int port, int timeoutMs) {
        Socket socket = null;
        try {
            socket = connect(socksPort, host, port, timeoutMs);
            return socket.isConnected();
        } catch (IOException e) {
            return false;
        } finally {
            closeQuietly(socket);
        }
    }

    /**
     * Delivers one frame and waits for the single-byte application ACK written
     * by the remote {@link TorOnionService} listener.
     */
    public static boolean sendFrame(int socksPort, String host, int port, String frame, int timeoutMs) {
        Socket socket = null;
        try {
            socket = connect(socksPort, host, port, timeoutMs);
            byte[] payload = frame.getBytes(StandardCharsets.UTF_8);
            DataOutputStream out = new DataOutputStream(socket.getOutputStream());
            out.writeInt(payload.length);
            out.write(payload);
            out.flush();
            DataInputStream in = new DataInputStream(socket.getInputStream());
            int ack = in.read();
            return ack == 0x06; // ASCII ACK
        } catch (IOException e) {
            return false;
        } finally {
            closeQuietly(socket);
        }
    }

    public static String readFrame(Socket socket) throws IOException {
        DataInputStream in = new DataInputStream(socket.getInputStream());
        int length = in.readInt();
        if (length <= 0 || length > MAX_FRAME_BYTES) {
            throw new IOException("frame length out of bounds: " + length);
        }
        byte[] payload = new byte[length];
        in.readFully(payload);
        return new String(payload, StandardCharsets.UTF_8);
    }

    public static void ack(Socket socket) throws IOException {
        OutputStream out = socket.getOutputStream();
        out.write(0x06);
        out.flush();
    }

    private static byte[] readFully(InputStream in, int len) throws IOException {
        byte[] buf = new byte[len];
        int read = 0;
        while (read < len) {
            int n = in.read(buf, read, len - read);
            if (n < 0) throw new IOException("SOCKS5 stream closed early");
            read += n;
        }
        return buf;
    }

    public static void closeQuietly(Socket socket) {
        if (socket == null) return;
        try {
            socket.close();
        } catch (IOException ignored) {
            // nothing to do
        }
    }
}
