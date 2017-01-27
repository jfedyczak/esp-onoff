#include "ets_sys.h"
#include "osapi.h"
#include "gpio.h"
#include "os_type.h"
#include "user_interface.h"
#include "espconn.h"
#include "mem.h"

// change GUID for every programmed device:
#define DEVICE_GUID "0ac1d020-7cd4-4ae4-9da3-241b4398bb8c"
#define DEVICE_TYPE "433TX"

#include "config.h"

// DEFINE THIS IN config.h:
//
// #define DEVICE_TARGET_IP "a.b.c.d"
// #define DEVICE_TARGET_PORT xxx
//
// #define DEVICE_WIFI_SSID "yourssid"
// #define DEVICE_WIFI_PASSWORD "yourpass"

#define DEVICE_ID_STRING DEVICE_TYPE ";" DEVICE_GUID "\n"

static volatile os_timer_t some_timer;
static volatile os_timer_t wifi_ready_timer;

void gpio2_on(void);
void gpio2_off(void);
void gpio3_on(void);
void gpio3_off(void);
void ICACHE_FLASH_ATTR setup_client();
void ICACHE_FLASH_ATTR wifi_ready_timer_cb(void *arg);
void ICACHE_FLASH_ATTR setup_gpio();
void ICACHE_FLASH_ATTR setup_wifi();
void ICACHE_FLASH_ATTR setup_client();
void ICACHE_FLASH_ATTR setup_network();
static void ICACHE_FLASH_ATTR client_connected_cb(void *arg);
static void ICACHE_FLASH_ATTR client_sent_cb(void *arg);
static void ICACHE_FLASH_ATTR client_recv_cb(void *arg, char *data, unsigned short len);
static void ICACHE_FLASH_ATTR client_reconnected_cb(void *arg, sint8 err);
static void ICACHE_FLASH_ATTR client_disconnected_cb(void *arg);

#define user_procTaskPrio        0
#define user_procTaskQueueLen    1
os_event_t user_procTaskQueue[user_procTaskQueueLen];

static char codeToEmit[40];
static int emissionCount = 0;

LOCAL struct espconn *pCon = NULL;

static void ICACHE_FLASH_ATTR loop(os_event_t *events) {
    int i;

    if (emissionCount > 0) {
        for (i = 0; i < strlen(codeToEmit); i++) {
            if (codeToEmit[i] == '1') {
                gpio3_on();
                os_delay_us(820);
                gpio3_off();
                os_delay_us(280);
            } else {
                gpio3_on();
                os_delay_us(280);
                gpio3_off();
                os_delay_us(820);
            }
        }
        emissionCount--;
        if (emissionCount > 0) {
            os_delay_us(9000);
        } else {
            char *resp = "OK\n";
            espconn_sent(pCon, resp, strlen(resp));
        }
    } else {
        os_delay_us(10000);
    }
    system_os_post(user_procTaskPrio, 0, 0 );
}

void gpio2_on(void) {
    GPIO_OUTPUT_SET(2, 1); // off
//    gpio_output_set((1 << 2), 0, 0, 0);
}

void gpio2_off(void) {
    GPIO_OUTPUT_SET(2, 0); // off
//    gpio_output_set(0, (1 << 2), 0, 0);
}
void gpio3_on(void) {
    GPIO_OUTPUT_SET(GPIO_ID_PIN(3), 1); // off
//    gpio_output_set((1 << 2), 0, 0, 0);
}

void gpio3_off(void) {
    GPIO_OUTPUT_SET(GPIO_ID_PIN(3), 0); // off
//    gpio_output_set(0, (1 << 2), 0, 0);
}


static void ICACHE_FLASH_ATTR client_connected_cb(void *arg) {
    struct espconn *conn=(struct espconn *)arg;

    char *data = DEVICE_ID_STRING;
    sint8 d = espconn_sent(conn, data, strlen(data));
}

static void ICACHE_FLASH_ATTR client_sent_cb(void *arg) {
}

static void ICACHE_FLASH_ATTR client_recv_cb(void *arg, char *data, unsigned short len) {
    struct espconn *conn=(struct espconn *)arg;
    int i;
    if (!strcmp(data,"PING\n")) {
        char *resp = "PONG\n";
        espconn_sent(conn, resp, strlen(resp));
    } else if (data[0] == '>') {
        if (emissionCount > 0) {
            char *resp = "BUSY\n";
            espconn_sent(conn, resp, strlen(resp));
            return;
        }
        char *resp = "OK\n";
        char *src = &data[1];
        char *code = codeToEmit;

        while (*src == '0' || *src == '1') {
            *code++ = *src++;
        }
        *code = '\0';
        emissionCount = 17;
    } else {
        char *resp = "ERROR\n";
        espconn_sent(conn, resp, strlen(resp));
    }
}

static void ICACHE_FLASH_ATTR client_reconnected_cb(void *arg, sint8 err) {
    setup_network();
}

static void ICACHE_FLASH_ATTR client_disconnected_cb(void *arg) {
    setup_network();
}

void ICACHE_FLASH_ATTR setup_client() {

    pCon = (struct espconn *)os_zalloc(sizeof(struct espconn));

    pCon->type = ESPCONN_TCP;
    pCon->state = ESPCONN_NONE;

    pCon->proto.tcp = (esp_tcp *)os_zalloc(sizeof(esp_tcp));
    pCon->proto.tcp->local_port = espconn_port();
    pCon->proto.tcp->remote_port = DEVICE_TARGET_PORT;

    uint32_t ip = ipaddr_addr(DEVICE_TARGET_IP);
    os_memcpy(pCon->proto.tcp->remote_ip, &ip, 4);

    struct ip_info ipconfig;
    wifi_get_ip_info(STATION_IF, &ipconfig);
    os_memcpy(pCon->proto.tcp->local_ip, &ipconfig.ip, 4);

    espconn_regist_connectcb(pCon, client_connected_cb);
    espconn_regist_disconcb(pCon, client_disconnected_cb);
    espconn_regist_reconcb(pCon, client_reconnected_cb);
    espconn_regist_recvcb(pCon, client_recv_cb);
    espconn_regist_sentcb(pCon, client_sent_cb);

    espconn_connect(pCon);
}

void ICACHE_FLASH_ATTR wifi_ready_timer_cb(void *arg) {
    uint8_t state;

    os_timer_disarm(&wifi_ready_timer);

    state = wifi_station_get_connect_status();
    if (state == STATION_GOT_IP) {
        setup_client();
        return;
    }
    os_timer_arm(&wifi_ready_timer, 500, 0);
}

void ICACHE_FLASH_ATTR setup_gpio()  {
    gpio_init();
   // gpio_output_set(0, 0, (1 << 2), 0);

    // PIN_FUNC_SELECT(PERIPHS_IO_MUX_U0TXD_U, FUNC_GPIO1); //use pin as GPIO1 instead of UART TXD
    // gpio_output_set(0, 0, 1 << 1, 0); // enable pin as output

    PIN_FUNC_SELECT(PERIPHS_IO_MUX_U0RXD_U, FUNC_GPIO3); //use pin as GPIO1 instead of UART TXD
    PIN_PULLUP_DIS(PERIPHS_IO_MUX_U0RXD_U);
    // gpio_output_set(0, 0, 1 << 3, 0); // enable pin as output

    gpio3_off();
}

void ICACHE_FLASH_ATTR setup_wifi() {
    const char ssid[32] = DEVICE_WIFI_SSID;
    const char password[64] = DEVICE_WIFI_PASSWORD;

    struct station_config stationConf;
    os_bzero(&stationConf, sizeof(struct station_config));
    wifi_set_opmode( 0x1 );
    stationConf.bssid_set = 0;
    os_memcpy(&stationConf.ssid, ssid, 32);
    os_memcpy(&stationConf.password, password, 64);
    wifi_station_set_config(&stationConf);
}

void setup_network() {
    os_timer_disarm(&wifi_ready_timer);
    os_timer_setfn(&wifi_ready_timer, (os_timer_func_t *)wifi_ready_timer_cb, NULL);
    os_timer_arm(&wifi_ready_timer, 500, 0);
}

void ICACHE_FLASH_ATTR user_init() {
    os_delay_us(10000);
    setup_gpio();
    setup_wifi();

    system_os_task(loop, user_procTaskPrio,user_procTaskQueue, user_procTaskQueueLen);
    system_os_post(user_procTaskPrio, 0, 0 );

    setup_network();
}
