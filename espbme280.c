#include "ets_sys.h"
#include "osapi.h"
#include "gpio.h"
#include "os_type.h"
#include "user_interface.h"
#include "espconn.h"
#include "mem.h"
#include "bme280.h"

// change GUID for every programmed device:
#define DEVICE_GUID "97c8b991-4c85-4a90-8cfc-e3cfa4a732f1"
#define DEVICE_TYPE "BME280"

#include "config.h"

// DEFINE THIS IN config.h:
//
// #define DEVICE_TARGET_IP "a.b.c.d"
// #define DEVICE_TARGET_PORT xxx
//
// #define DEVICE_WIFI_SSID "yourssid"
// #define DEVICE_WIFI_PASSWORD "yourpass"

// #undef DEVICE_TARGET_IP
// #define DEVICE_TARGET_IP "10.0.1.8"
#undef DEVICE_TARGET_PORT
#define DEVICE_TARGET_PORT 38000

#define DEVICE_ID_STRING DEVICE_TYPE ";" DEVICE_GUID "\n"


static volatile os_timer_t some_timer;
static volatile os_timer_t wifi_ready_timer;
uint8_t bme_ok;

sint32 temperature;
uint32 pressure, humidity;

void ICACHE_FLASH_ATTR setup_client();
void ICACHE_FLASH_ATTR wifi_ready_timer_cb(void *arg);
void ICACHE_FLASH_ATTR setup_gpio();
void ICACHE_FLASH_ATTR setup_wifi();
void ICACHE_FLASH_ATTR setup_client();
void ICACHE_FLASH_ATTR setup_network();
void ICACHE_FLASH_ATTR go_down();
static void ICACHE_FLASH_ATTR client_connected_cb(void *arg);
static void ICACHE_FLASH_ATTR client_sent_cb(void *arg);
static void ICACHE_FLASH_ATTR client_recv_cb(void *arg, char *data, unsigned short len);
static void ICACHE_FLASH_ATTR client_reconnected_cb(void *arg, sint8 err);
static void ICACHE_FLASH_ATTR client_disconnected_cb(void *arg);

#define user_procTaskPrio        0
#define user_procTaskQueueLen    1
os_event_t user_procTaskQueue[user_procTaskQueueLen];

LOCAL struct espconn *pCon = NULL;

static void ICACHE_FLASH_ATTR loop(os_event_t *events) {

    os_delay_us(10000);

    system_os_post(user_procTaskPrio, 0, 0 );
}

char* ICACHE_FLASH_ATTR itoa(int i, char b[]){
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

    if (!bme_ok) {
        char *data = "ERROR\n";
        espconn_sent(conn, data, strlen(data));
        return;
    }

    BME280_ReadAll(&temperature, &pressure, &humidity);

    char temp[30];
    char *b;
    int tread;

    b = temp;

    tread = temperature / 100;
    b += strlen(itoa(tread, b));
    tread = temperature % 100;
    *b++ = '.';
    if (tread < 10) *b++ = '0';
    b += strlen(itoa(tread, b));
    *b++ = ';';

    tread = (pressure >> 8) / 100;
    b += strlen(itoa(tread, b));
    tread = (pressure >> 8) % 100;
    *b++ = '.';
    if (tread < 10) *b++ = '0';
    b += strlen(itoa(tread, b));
    *b++ = ';';

    tread = humidity >> 10;
    b += strlen(itoa(tread, b));
    tread = ((humidity & 0x000003FF) * 100) >> 10;
    *b++ = '.';
    if (tread < 10) *b++ = '0';
    b += strlen(itoa(tread, b));

    *b++ = '\n';
    *b++ = '\0';


    espconn_sent(conn, temp, strlen(temp));
}

static void ICACHE_FLASH_ATTR client_sent_cb(void *arg) {
    struct espconn *conn=(struct espconn *)arg;
    espconn_disconnect(conn);
}

static void ICACHE_FLASH_ATTR client_recv_cb(void *arg, char *data, unsigned short len) {
}

static void ICACHE_FLASH_ATTR client_reconnected_cb(void *arg, sint8 err) {
    setup_network();
}

static void ICACHE_FLASH_ATTR client_disconnected_cb(void *arg) {
    go_down();
    // setup_network();
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

    i2c_master_gpio_init();
    i2c_master_init();
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

void ICACHE_FLASH_ATTR setup_network() {
    os_timer_disarm(&wifi_ready_timer);
    os_timer_setfn(&wifi_ready_timer, (os_timer_func_t *)wifi_ready_timer_cb, NULL);
    os_timer_arm(&wifi_ready_timer, 500, 0);
}

void ICACHE_FLASH_ATTR go_down() {
    BME280_SetMode(BME280_MODE_SLEEP);
    system_deep_sleep_set_option(2);
    system_deep_sleep(5 * 60 * 1000 * 1000);
}

static volatile os_timer_t my_timer;

void ICACHE_FLASH_ATTR user_init() {
    os_delay_us(10000);
    setup_gpio();
    setup_wifi();

    uint8_t adr;
    bme_ok = !BME280_Init(BME280_OS_T_16, BME280_OS_P_16, BME280_OS_H_16,
					BME280_FILTER_16, BME280_MODE_NORMAL, BME280_TSB_05);
    os_delay_us(100000);

    system_os_task(loop, user_procTaskPrio,user_procTaskQueue, user_procTaskQueueLen);
    system_os_post(user_procTaskPrio, 0, 0 );

    os_timer_setfn(&my_timer, (os_timer_func_t *)go_down, NULL);
    os_timer_arm(&my_timer, 5 * 1000, 0);

    setup_network();
}
