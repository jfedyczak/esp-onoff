#include "ets_sys.h"
#include "osapi.h"
#include "gpio.h"
#include "os_type.h"
#include "user_interface.h"
#include "espconn.h"
#include "mem.h"
#include "ds18b20.h"
#include "stdlib.h"

// change GUID for every programmed device:
#define DEVICE_GUID "375433ac-c371-4d15-816b-1bbbb4b4f1d4"
#define DEVICE_TYPE "TEMP"

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

LOCAL struct espconn *pCon = NULL;
LOCAL struct sensor_reading *tempRead = NULL;

static void ICACHE_FLASH_ATTR loop(os_event_t *events) {

    os_delay_us(10000);

    system_os_post(user_procTaskPrio, 0, 0 );
}

char* itoa(int i, char b[]){
    char const digit[] = "0123456789";
    char* p = b;
    if(i<0){
        *p++ = '-';
        i *= -1;
    }
    int shifter = i;
    do{ //Move to where representation ends
        ++p;
        shifter = shifter/10;
    }while(shifter);
    *p = '\0';
    do{ //Move back, inserting digits as u go
        *--p = digit[i%10];
        i = i/10;
    }while(i);
    return b;
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
    } else if (!strcmp(data, "READ\n")) {
        tempRead = readDS18B20();
        if (tempRead->success) {
            char temp[20];
            char *b;
            b = temp;
            int tread = 100 * tempRead->temperature;
            b += strlen(itoa(tread / 100, b));
            tread = tread % 100;
            *b++ = '.';
            if (tread < 10) *b++ = '0';
            b += strlen(itoa(tread, b));
            *b++ = '\n';
            *b++ = '\0';
            espconn_sent(conn, temp, strlen(temp));
        } else {
            char *resp = "ERROR\n";
            espconn_sent(conn, resp, strlen(resp));
        }
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

    setup_DS1820();

    tempRead = readDS18B20();
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
