self.addEventListener("push", function (event) {
  event.waitUntil(fetch("/api/latest-alert").then(function (res) { return res.json(); }).catch(function () { return { title: "Multimedia Club", body: "New club update." }; }).then(function (data) {
    return self.registration.showNotification(data.title || "Multimedia Club", { body: data.body || "New club update.", icon: "/images/logo.jpg" });
  }));
});
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
